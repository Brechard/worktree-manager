#!/usr/bin/env node
// Smoke-check an unpacked Electron executable, never the developer's profile.
// Usage: node scripts/smoke-packaged.mjs <executable> [--screenshot <png>] [--timeout-ms <ms>]
// Linux CI may wrap this command in xvfb-run -a and pass --no-sandbox to Electron.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

function usage() {
  throw new Error(
    'Usage: node scripts/smoke-packaged.mjs <executable> [--screenshot <png>] [--timeout-ms <ms>] [--no-sandbox]'
  )
}

const args = process.argv.slice(2)
if (!args.length || args[0].startsWith('--')) usage()
const executable = resolve(args.shift())
if (!existsSync(executable)) throw new Error(`Executable does not exist: ${executable}`)
let screenshot
let timeoutMs = 30_000
let noSandbox = false
while (args.length) {
  const flag = args.shift()
  if (flag === '--screenshot' && args.length) screenshot = resolve(args.shift())
  else if (flag === '--timeout-ms' && args.length) {
    timeoutMs = Number(args.shift())
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) usage()
  } else if (flag === '--no-sandbox' && process.platform === 'linux') noSandbox = true
  else usage()
}

const profile = mkdtempSync(resolve(tmpdir(), 'worktree-manager-smoke-'))
// Seed empty records explicitly, so this run cannot inherit repositories or scan roots.
mkdirSync(resolve(profile, 'config'))
writeFileSync(resolve(profile, 'config', 'repositories.json'), '[]\n')
writeFileSync(resolve(profile, 'config', 'worktrees.json'), '[]\n')
const deadline = Date.now() + timeoutMs
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const remaining = () => Math.max(0, deadline - Date.now())
let child
let socket
let childExit
let childClose
let output = ''

function waitForClose(processToWaitFor, timeoutMs) {
  return new Promise((resolve) => {
    const finish = (closed) => {
      clearTimeout(timer)
      processToWaitFor.off('close', onClose)
      processToWaitFor.off('error', onError)
      resolve(closed)
    }
    const onClose = () => {
      finish(true)
    }
    const onError = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    processToWaitFor.once('close', onClose)
    processToWaitFor.once('error', onError)
  })
}

function listenPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

function connect(url) {
  return new Promise((accept, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(
      () => {
        ws.close()
        reject(new Error('CDP connection timed out'))
      },
      Math.min(5_000, remaining())
    )
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        accept(ws)
      },
      { once: true }
    )
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('CDP connection failed'))
      },
      { once: true }
    )
  })
}

function makeCdp(ws) {
  let nextId = 0
  const pending = new Map()
  const exceptions = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      exceptions.push(
        details.exception?.description || details.text || 'Unknown renderer exception'
      )
    }
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    message.error
      ? request.reject(new Error(message.error.message))
      : request.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolveResult, reject) => {
      const id = ++nextId
      const timer = setTimeout(
        () => {
          pending.delete(id)
          reject(new Error(`${method} timed out`))
        },
        Math.min(5_000, remaining())
      )
      pending.set(id, { resolve: resolveResult, reject, timer })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, exceptions }
}

async function stopChild() {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    // taskkill may return before Electron has released its profile handles.
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    let killerClosed = await waitForClose(killer, 5_000)
    if (!killerClosed) {
      killer.kill()
      killerClosed = await waitForClose(killer, 1_000)
    }
    const appClosed = childClose || (await waitForClose(child, 5_000))
    if (!appClosed) throw new Error(`App process pid=${child.pid} did not close after taskkill`)
    if (!killerClosed) throw new Error('taskkill did not close within the cleanup timeout')
  } else {
    // The child owns its process group; never signal another app or the caller.
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already exited */
    }
    if (!childExit)
      await Promise.race([new Promise((done) => child.once('exit', done)), sleep(2_000)])
    if (!childExit)
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* already exited */
      }
  }
}

try {
  const port = await listenPort()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const launchArgs = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    ...(noSandbox ? ['--no-sandbox'] : []),
  ]
  child = spawn(executable, launchArgs, {
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.once('exit', (code, signal) => {
    childExit = { code, signal }
  })
  child.once('close', () => {
    childClose = true
  })
  child.once('error', (error) => {
    childExit = { error: error.message }
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-16_000)
    })
  }
  console.log(
    `Launched packaged app pid=${child.pid} CDP=127.0.0.1:${port} isolatedProfile=${profile}`
  )

  let target
  while (remaining()) {
    if (childExit)
      throw new Error(`App exited before renderer loaded: ${JSON.stringify(childExit)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(Math.min(1_000, remaining())),
      })
      if (response.ok) {
        const targets = await response.json()
        target = targets.find(
          (item) => item.type === 'page' && item.webSocketDebuggerUrl && item.url !== 'about:blank'
        )
        if (target) break
      }
    } catch {
      /* CDP is still starting */
    }
    await sleep(100)
  }
  if (!target) throw new Error('No app renderer target appeared before timeout')
  socket = await connect(target.webSocketDebuggerUrl)
  const cdp = makeCdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  let state
  while (remaining()) {
    if (childExit) throw new Error(`App exited while renderer loaded: ${JSON.stringify(childExit)}`)
    if (cdp.exceptions.length) throw new Error(`Renderer exception: ${cdp.exceptions.join(' | ')}`)
    const result = await cdp.send('Runtime.evaluate', {
      expression: `({ title: document.title, text: document.body?.innerText || '', visible: !!document.querySelector('#root') && document.querySelector('#root').getBoundingClientRect().width > 0 && document.querySelector('#root').getBoundingClientRect().height > 0, api: !!window.api })`,
      returnByValue: true,
    })
    state = result.result?.value
    if (result.exceptionDetails)
      throw new Error(`Renderer evaluation failed: ${result.exceptionDetails.text}`)
    if (state?.text?.includes('Failed to start')) throw new Error(`App boot failed: ${state.text}`)
    if (
      state?.visible &&
      state.api &&
      state.title === 'Worktree Manager' &&
      state.text.includes('Find your repositories')
    )
      break
    await sleep(150)
  }
  if (
    !state?.visible ||
    !state.api ||
    state.title !== 'Worktree Manager' ||
    !state.text.includes('Find your repositories')
  ) {
    throw new Error(`Renderer never reached onboarding: ${JSON.stringify(state)}`)
  }
  // Give late startup errors a brief chance to arrive after the first paint.
  await sleep(500)
  if (childExit) throw new Error(`App exited after renderer loaded: ${JSON.stringify(childExit)}`)
  if (cdp.exceptions.length) throw new Error(`Renderer exception: ${cdp.exceptions.join(' | ')}`)
  if (screenshot) {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    })
    const png = Buffer.from(shot.data, 'base64')
    if (png.length < 1_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
      throw new Error('CDP returned an invalid or blank screenshot')
    mkdirSync(dirname(screenshot), { recursive: true })
    writeFileSync(screenshot, png)
    console.log(`Screenshot: ${screenshot} (${png.length} bytes)`)
  }
  console.log(
    `PASS packaged renderer: ${state.title}; onboarding visible; Electron API available; no renderer exceptions`
  )
} catch (error) {
  console.error(`FAIL packaged smoke: ${error.message}`)
  if (output.trim()) console.error(`App output (last 16 KB):\n${output.trim()}`)
  process.exitCode = 1
} finally {
  socket?.close()
  try {
    await stopChild()
  } catch (error) {
    console.error(`FAIL packaged smoke cleanup: ${error.message}`)
    process.exitCode = 1
  }
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      ...(process.platform === 'win32' ? { maxRetries: 8, retryDelay: 250 } : {}),
    })
  } catch (error) {
    console.error(
      `FAIL packaged smoke cleanup: could not remove temporary profile ${profile}: ${error.message}`
    )
    process.exitCode = 1
  }
}
