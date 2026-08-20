import type { ProviderConfig, ProviderType } from '@worktree/contracts'

export function normalizeRemoteUrl(url: string): string {
  let u = url.trim()
  // git@host:org/repo.git
  const scp = u.match(/^git@([^:]+):(.+)$/)
  if (scp) {
    u = `https://${scp[1]}/${scp[2]}`
  }
  // ssh://git@host/org/repo.git
  u = u.replace(/^ssh:\/\/git@/i, 'https://')
  u = u.replace(/^git:\/\//i, 'https://')
  u = u.replace(/\.git$/i, '')
  return u
}

export function parseProviderFromRemoteUrl(remoteUrl: string): ProviderConfig | undefined {
  const normalized = normalizeRemoteUrl(remoteUrl)
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return undefined
  }

  const host = parsed.hostname.toLowerCase()
  const parts = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean)

  // ssh.dev.azure.com/v3/org/project/repo (after normalize)
  if (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') {
    // path often: v3/org/project/repo
    const idx = parts[0] === 'v3' ? 1 : 0
    if (parts.length >= idx + 3) {
      return {
        type: 'azure',
        organization: parts[idx]!,
        project: parts[idx + 1]!,
        repository: parts[idx + 2]!,
        source: 'remote',
      }
    }
  }

  // github.com/owner/repo or github.enterprise/...
  if (host === 'github.com' || host.endsWith('.github.com')) {
    if (parts.length >= 2) {
      const owner = parts[0]!
      const repo = parts[1]!.replace(/\.git$/i, '')
      return {
        type: 'github',
        organization: owner,
        repository: `${owner}/${repo}`,
        source: 'remote',
      }
    }
  }

  // dev.azure.com/{org}/{project}/_git/{repo}
  // or {org}.visualstudio.com/{project}/_git/{repo}
  if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) {
    if (host.endsWith('.visualstudio.com')) {
      const org = host.replace(/\.visualstudio\.com$/i, '')
      // path: project/_git/repo  OR DefaultCollection/project/_git/repo
      const gitIdx = parts.indexOf('_git')
      if (gitIdx >= 1 && parts[gitIdx + 1]) {
        const project =
          parts[gitIdx - 1] === 'DefaultCollection' && gitIdx >= 2
            ? parts[gitIdx - 1]!
            : parts[gitIdx - 1]!
        const repo = parts[gitIdx + 1]!
        return {
          type: 'azure',
          organization: org,
          project,
          repository: repo,
          source: 'remote',
        }
      }
    } else {
      // dev.azure.com/org/project/_git/repo
      const gitIdx = parts.indexOf('_git')
      if (parts.length >= 2 && gitIdx >= 2 && parts[gitIdx + 1]) {
        return {
          type: 'azure',
          organization: parts[0]!,
          project: parts[1]!,
          repository: parts[gitIdx + 1]!,
          source: 'remote',
        }
      }
      // sometimes without _git: org/project/repo
      if (parts.length >= 3 && !parts.includes('_git')) {
        return {
          type: 'azure',
          organization: parts[0]!,
          project: parts[1]!,
          repository: parts[2]!,
          source: 'remote',
        }
      }
    }
  }

  return undefined
}

export function providerLabel(type: ProviderType): string {
  return type === 'github' ? 'GitHub' : 'Azure DevOps'
}
