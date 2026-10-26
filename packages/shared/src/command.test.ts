import { describe, expect, test } from 'bun:test'
import { runShellCommand } from './command.js'

describe('project command output', () => {
  test('a silent failed command never exposes its literal command in the result', async () => {
    const result = await runShellCommand('SECRET=synthetic-review-marker; exit 7', {
      cwd: '/tmp',
      timeoutSeconds: 5,
    })
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(7)
    expect(result.output).toBe('Command exited with status 7.')
    expect(result.output).not.toContain('synthetic-review-marker')
  })
})
