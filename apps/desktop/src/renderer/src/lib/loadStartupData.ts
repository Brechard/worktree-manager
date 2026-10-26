import type { AppSettings, Repository, Worktree } from '@worktree/contracts'
import { api } from '../api'
import { mergeDiscoveredRepository } from './repositories'

export interface StartupData {
  settings: AppSettings
  repositories: Repository[]
  worktrees: Worktree[]
}

/** Main owns the persisted records; a scan must be read back after its merge. */
export async function loadStartupData(
  onSettings: (settings: AppSettings) => void,
  onScanning: (scanning: boolean) => void,
  subscribeProgress: () => () => void,
  isCancelled: () => boolean
): Promise<StartupData | null> {
  if (!window.api) throw new Error('Electron API is not available. Restart the desktop app.')
  const [settings, existingRepos, existingWorktrees] = await Promise.all([
    api.getSettings(),
    api.getRepositories(),
    api.getWorktrees(),
  ])
  if (isCancelled()) return null
  onSettings(settings)

  let repositories = existingRepos
  let worktrees = existingWorktrees
  const roots = new Set<string>()
  for (const dir of settings.watchedDirectories ?? []) {
    if (dir.trim().length > 0) roots.add(dir)
  }
  for (const repo of existingRepos) {
    if (repo.path.trim().length > 0) roots.add(repo.path)
  }

  if (roots.size > 0) {
    const removeProgress = subscribeProgress()
    onScanning(true)
    try {
      const result = await api.discoverWorktrees({ roots: Array.from(roots), maxDepth: 5 })
      if (!result.cancelled) {
        const existingByPath = new Map(existingRepos.map((repo) => [repo.path, repo]))
        const existingById = new Map(existingRepos.map((repo) => [repo.id, repo]))
        repositories = result.repositories.map((repo) =>
          mergeDiscoveredRepository(
            repo,
            existingByPath.get(repo.path) || existingById.get(repo.id)
          )
        )
        const discoveredIds = new Set(result.repositories.map((repo) => repo.id))
        const kept = existingWorktrees.filter(
          (worktree) => !discoveredIds.has(worktree.repositoryId)
        )
        worktrees = [...kept, ...result.worktrees]
        await Promise.all([api.setRepositories(repositories), api.setWorktrees(worktrees)])
        worktrees = await api.getWorktrees()
      }
    } finally {
      onScanning(false)
      removeProgress()
    }
  }
  return { settings, repositories, worktrees }
}
