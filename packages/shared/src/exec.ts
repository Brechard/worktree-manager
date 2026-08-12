import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runGit(
  cwd: string,
  args: string[],
  options?: { maxBuffer?: number; timeout?: number; raw?: boolean }
): Promise<ExecResult> {
  const clean = (value: string) => (options?.raw ? value : value.trim())
  return execFileAsync('git', args, {
    cwd,
    maxBuffer: options?.maxBuffer ?? 1024 * 1024,
    timeout: options?.timeout ?? 30000,
    windowsHide: true,
  })
    .then(({ stdout, stderr }) => ({ stdout: clean(stdout), stderr: clean(stderr), exitCode: 0 }))
    .catch((error) => {
      if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
        const err = error as { stdout?: string; stderr?: string; code?: number }
        return {
          stdout: clean(err.stdout ?? ''),
          stderr: clean(err.stderr ?? ''),
          exitCode: err.code ?? 1,
        }
      }
      throw error
    })
}

export async function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; shell?: boolean; maxBuffer?: number }
): Promise<ExecResult> {
  return execFileAsync(command, args, {
    cwd: options?.cwd,
    timeout: options?.timeout ?? 30000,
    maxBuffer: options?.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
    shell: options?.shell ?? false,
  })
    .then(({ stdout, stderr }) => ({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 }))
    .catch((error) => {
      if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
        const err = error as { stdout?: string; stderr?: string; code?: number }
        return {
          stdout: err.stdout?.trim() ?? '',
          stderr: err.stderr?.trim() ?? '',
          exitCode: err.code ?? 1,
        }
      }
      throw error
    })
}
