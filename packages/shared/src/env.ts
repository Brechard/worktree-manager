import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * PATH a macOS app gets when launched from Finder/Dock/Spotlight. launchd hands
 * out this bare list, so `az`, `gh`, `docker` and every other tool installed by
 * Homebrew or a version manager are invisible to the app — even though they
 * work fine in the user's terminal.
 */
const LAUNCHD_PATH_ENTRIES = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

/**
 * Last-resort additions for when the login shell can't be probed (no $SHELL,
 * a shell that hangs, an rc file that errors out) or when the user keeps their
 * PATH exports in a non-login rc file like `.zshrc`. Only entries that actually
 * exist are appended.
 */
const FALLBACK_PATH_ENTRIES = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), 'bin'),
]

/** Fenced so rc-file chatter (banners, `nvm` notices) can't corrupt the value. */
const MARKER = '__WTM_PATH__'

const PROBE_TIMEOUT_MS = 5000

function splitPath(value: string | undefined): string[] {
  return (value ?? '').split(delimiter).filter(Boolean)
}

/**
 * True when the process PATH is nothing but the launchd defaults, i.e. we were
 * started by the OS rather than from a shell. A terminal launch (`npm run dev`)
 * already carries the user's real PATH and needs no probing.
 */
function looksLikeLaunchdPath(value: string | undefined): boolean {
  const entries = splitPath(value)
  return entries.every((entry) => LAUNCHD_PATH_ENTRIES.includes(entry))
}

async function readLoginShellPath(): Promise<string[]> {
  const shell = process.env.SHELL
  if (!shell || !existsSync(shell)) return []

  return new Promise<string[]>((resolve) => {
    execFile(
      shell,
      ['-lc', `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          resolve([])
          return
        }
        const parts = (stdout ?? '').split(MARKER)
        resolve(parts.length >= 3 ? splitPath(parts[1]) : [])
      }
    )
  })
}

/**
 * Give the main process the PATH the user actually has in their terminal.
 *
 * Every child process we spawn inherits `process.env`, so doing this once at
 * startup is what makes `az`, `gh` and editor launchers resolvable in a
 * Finder-launched build. Without it `detectProviderToken` fails with ENOENT and
 * reports "no token found", which reads as an auth problem rather than a
 * missing binary.
 *
 * Safe to call more than once; entries are merged and de-duplicated in place.
 */
export async function hydrateShellPath(): Promise<string> {
  const current = splitPath(process.env.PATH)

  // Windows GUI apps inherit the full system PATH already.
  if (process.platform === 'win32') return process.env.PATH ?? ''

  const fromShell = looksLikeLaunchdPath(process.env.PATH) ? await readLoginShellPath() : []
  const fallback = FALLBACK_PATH_ENTRIES.filter((entry) => existsSync(entry))

  const merged: string[] = []
  for (const entry of [...fromShell, ...current, ...fallback]) {
    if (!merged.includes(entry)) merged.push(entry)
  }

  process.env.PATH = merged.join(delimiter)
  return process.env.PATH
}
