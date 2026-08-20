import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { runCommand } from './exec.js'

/** Ten minutes: pulling down a Docker stack with volumes is not quick. */
export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 600

/** Which worktree a project-defined command is being run for. */
export interface CommandContext {
  worktreePath: string
  branch?: string
  /** The repository's main checkout — the fallback cwd for a missing worktree. */
  repoPath: string
  repoName?: string
}

export interface CommandOutcome {
  success: boolean
  output: string
  exitCode?: number
  timedOut?: boolean
}

/**
 * The environment every project-defined command gets, so a hook or an action can
 * be written once and work for whichever worktree the button belongs to.
 */
export function commandEnv(context: CommandContext): Record<string, string> {
  return {
    WORKTREE_PATH: context.worktreePath,
    WORKTREE_BRANCH: context.branch ?? '',
    REPO_PATH: context.repoPath,
    REPO_NAME: context.repoName ?? '',
  }
}

/**
 * Resolve a project's working subdirectory against one worktree.
 *
 * Falls back to the root rather than failing: a subdirectory that doesn't exist
 * in *this* worktree (an older branch from before the folder was added) should
 * still open a terminal somewhere useful. A value that would escape the
 * worktree is ignored outright.
 */
export function resolveWorkingDirectory(root: string, subdirectory?: string): string {
  const trimmed = subdirectory?.trim()
  if (!trimmed) return root
  const target = resolve(root, trimmed)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) return root
  return existsSync(target) ? target : root
}

/**
 * Run a command through the user's login shell and wait for it.
 *
 * A login shell so the command can be written the way it would be typed in a
 * terminal — pipes, `$(…)`, and a PATH that actually has `docker` on it.
 * Electron apps launched from Finder inherit a bare PATH, so a plain
 * `docker compose …` would otherwise fail with "command not found" for exactly
 * the users who never start the app from a terminal.
 *
 * `interactive` additionally sources the interactive rc file (`.zshrc`), which
 * is where version managers like nvm put themselves — without it `npm` resolves
 * to whatever system node exists rather than the one the project is built with.
 * It is opt-in because an interactive shell also runs whatever else that file
 * does, and the pre-delete hook has shipped without it.
 */
export async function runShellCommand(
  command: string,
  options: {
    cwd: string
    env?: Record<string, string>
    timeoutSeconds?: number
    interactive?: boolean
  }
): Promise<CommandOutcome> {
  const trimmed = command.trim()
  if (!trimmed) return { success: true, output: '' }

  const timeout = Math.max(1, options.timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS) * 1000
  const shell = process.env.SHELL || '/bin/sh'

  return new Promise<CommandOutcome>((settle) => {
    execFile(
      shell,
      [options.interactive ? '-lic' : '-lc', trimmed],
      {
        cwd: options.cwd,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...options.env },
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr]
          .map((s) => (s ?? '').trim())
          .filter(Boolean)
          .join('\n')
        if (!error) {
          settle({ success: true, output, exitCode: 0 })
          return
        }
        const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true
        const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code
        settle({
          success: false,
          output: output || error.message,
          ...(typeof exitCode === 'number' ? { exitCode } : {}),
          ...(killed ? { timedOut: true } : {}),
        })
      }
    )
  })
}

/** `'` is the only character single quotes can't carry, so break out for it. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Escape for embedding inside an AppleScript `"…"` literal.
 *
 * Newlines have to become `\n` escapes rather than travel literally: AppleScript
 * string literals cannot span lines, so a multi-line command would otherwise
 * fail to compile and the action would silently fall back to the script-file
 * route. Escaped, `do script` types the line breaks and runs every line.
 */
function appleScriptQuote(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\\n')
    .replace(/\n/g, '\\n')
}

/**
 * The single line a terminal window should end up running: move to the right
 * directory, export the worktree variables, then the user's command. Written as
 * one line because that's what both AppleScript dialects can type into a shell.
 */
export function composeShellLine(
  command: string,
  cwd: string,
  env: Record<string, string> = {}
): string {
  const parts = [`cd ${shellQuote(cwd)}`]
  const exports = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`)
  if (exports.length > 0) parts.push(`export ${exports.join(' ')}`)
  parts.push(command.trim())
  return parts.join(' && ')
}

/**
 * Terminals we can drive directly. AppleScript hands the line to a real
 * interactive login shell — the same thing as typing it — so a dev server finds
 * the node its `.zshrc` installed, keeps printing, and dies on ctrl-C.
 */
const APPLESCRIPT_TERMINALS: Record<string, (line: string) => string> = {
  Terminal: (line) => `tell application "Terminal"\nactivate\ndo script "${line}"\nend tell`,
  iTerm: (line) =>
    `tell application "iTerm"\nactivate\nset newWindow to (create window with default profile)\ntell current session of newWindow to write text "${line}"\nend tell`,
}

/** Drop scripts from previous sessions so the temp directory doesn't grow forever. */
async function pruneOldScripts(dir: string): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const files = await readdir(dir).catch(() => [] as string[])
  await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith('.command')) return
      const path = join(dir, file)
      const stats = await stat(path).catch(() => undefined)
      if (stats && stats.mtimeMs < cutoff) await unlink(path).catch(() => undefined)
    })
  )
}

/**
 * Last resort for terminals with no scripting interface: a `.command` file,
 * which macOS hands to whichever terminal is asked to open it. The script runs
 * an interactive login shell explicitly, since executing a file this way is not
 * guaranteed to go through one — and that is what puts the user's real PATH
 * (nvm, asdf, homebrew) in front of the command.
 */
async function launchViaCommandFile(
  line: string,
  terminal: string,
  label: string
): Promise<CommandOutcome> {
  const dir = join(tmpdir(), 'worktree-manager-actions')
  await mkdir(dir, { recursive: true })
  await pruneOldScripts(dir)

  const slug = label.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || 'action'
  const script = join(dir, `${slug}-${Date.now()}.command`)
  const shell = process.env.SHELL || '/bin/sh'
  await writeFile(script, `#!/bin/sh\nexec ${shellQuote(shell)} -l -i -c ${shellQuote(line)}\n`)
  await chmod(script, 0o755)

  const result = await runCommand('open', ['-a', terminal, script], { timeout: 15000 })
  if (result.exitCode === 0) return { success: true, output: '' }
  return {
    success: false,
    output:
      result.stderr ||
      `Could not open ${terminal}. Pick a different terminal in Settings, or use Terminal.app.`,
  }
}

/**
 * Open a new terminal window running `command`. Resolves as soon as the window
 * is up — a dev server's lifetime belongs to the terminal, not to this app.
 */
export async function openCommandInTerminal(
  command: string,
  options: { cwd: string; env?: Record<string, string>; terminal?: string; label?: string }
): Promise<CommandOutcome> {
  const trimmed = command.trim()
  if (!trimmed) return { success: true, output: '' }
  if (process.platform !== 'darwin') {
    return {
      success: false,
      output: 'Running an action in a terminal window is only supported on macOS.',
    }
  }

  const line = composeShellLine(trimmed, options.cwd, options.env ?? {})
  const terminal = options.terminal?.trim() || 'Terminal'
  const script = APPLESCRIPT_TERMINALS[terminal]

  if (script) {
    const result = await runCommand('osascript', ['-e', script(appleScriptQuote(line))], {
      timeout: 15000,
    })
    if (result.exitCode === 0) return { success: true, output: '' }
    // A scripting failure (permission denied, app missing) still leaves the
    // file route worth trying before giving up.
    const fallback = await launchViaCommandFile(line, terminal, options.label ?? 'action')
    if (fallback.success) return fallback
    return { success: false, output: result.stderr || fallback.output }
  }

  return launchViaCommandFile(line, terminal, options.label ?? 'action')
}

/**
 * Run one of a project's custom actions for a worktree. The two modes exist for
 * two different shapes of command: something that keeps running and has to be
 * watched, and something that finishes and has a result worth reporting.
 */
export async function runProjectCommand(options: {
  command: string
  context: CommandContext
  /** The project's working subdirectory, relative to the worktree root. */
  subdirectory?: string
  mode: 'terminal' | 'background'
  /** macOS app name of the terminal to open, for `terminal` mode. */
  terminal?: string
  timeoutSeconds?: number
  /** Used to name the temp script when a terminal has to be driven by file. */
  label?: string
}): Promise<CommandOutcome> {
  const root = existsSync(options.context.worktreePath)
    ? options.context.worktreePath
    : options.context.repoPath
  if (!existsSync(root)) {
    return {
      success: false,
      output: `Neither the worktree nor ${options.context.repoPath} exists.`,
    }
  }

  const cwd = resolveWorkingDirectory(root, options.subdirectory)
  const env = commandEnv(options.context)

  if (options.mode === 'terminal') {
    return openCommandInTerminal(options.command, {
      cwd,
      env,
      ...(options.terminal ? { terminal: options.terminal } : {}),
      ...(options.label ? { label: options.label } : {}),
    })
  }

  return runShellCommand(options.command, {
    cwd,
    env,
    // Match what the terminal window would give the same command, so moving an
    // action between the two modes doesn't change which `node` it finds.
    interactive: true,
    ...(options.timeoutSeconds ? { timeoutSeconds: options.timeoutSeconds } : {}),
  })
}
