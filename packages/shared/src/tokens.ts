import type { DetectedToken, ProviderType } from '@worktree/contracts'
import { runCommand } from './exec.js'

export async function detectProviderToken(
  provider: ProviderType
): Promise<DetectedToken | undefined> {
  if (provider === 'github') {
    // env first
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_PAT']) {
      const v = process.env[key]
      if (v && v.length > 8) {
        return { provider: 'github', token: v, source: `env:${key}` }
      }
    }
    // gh auth token
    try {
      const { stdout, exitCode } = await runCommand('gh', ['auth', 'token'], { timeout: 8000 })
      if (exitCode === 0 && stdout.trim().length > 8) {
        return { provider: 'github', token: stdout.trim(), source: 'gh auth token' }
      }
    } catch (error) {
      // Almost always ENOENT: the binary is not on the app's PATH.
      console.warn('[tokens] gh auth token failed:', error)
    }
  }

  if (provider === 'azure') {
    for (const key of ['AZURE_DEVOPS_EXT_PAT', 'AZURE_DEVOPS_PAT', 'ADO_PAT', 'SYSTEM_ACCESSTOKEN']) {
      const v = process.env[key]
      if (v && v.length > 8) {
        return { provider: 'azure', token: v, source: `env:${key}` }
      }
    }
    // az devops login / az account get-access-token is more complex; try az devops
    try {
      const { stdout, exitCode } = await runCommand(
        'az',
        ['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--query', 'accessToken', '-o', 'tsv'],
        { timeout: 12000 }
      )
      if (exitCode === 0 && stdout.trim().length > 8) {
        return { provider: 'azure', token: stdout.trim(), source: 'az account get-access-token' }
      }
    } catch (error) {
      console.warn('[tokens] az account get-access-token failed:', error)
    }
  }

  return undefined
}
