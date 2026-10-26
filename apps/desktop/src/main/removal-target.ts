import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getWorktreeList } from '@worktree/shared'
import type { Repository, Worktree } from '@worktree/contracts'

/** Only a persisted, non-primary worktree belonging to a persisted repository can be removed. */
export async function verifiedRemovalTarget(
  path: string,
  repoPath: string,
  repositories: Repository[],
  worktrees: Worktree[]
): Promise<{ worktree: Worktree; repository: Repository } | undefined> {
  const canonical = async (value: string) => realpath(value).catch(() => resolve(value))
  const [requestedRepo, requestedPath, repositoryPaths] = await Promise.all([
    canonical(repoPath),
    canonical(path),
    Promise.all(repositories.map((item) => canonical(item.path))),
  ])
  // Resolve persisted paths as a batch, then keep the last matching record as
  // the original ordered lookup did. Every path remains checked before use.
  const repository = repositories
    .map((item, index) => ({ item, path: repositoryPaths[index] }))
    .reverse()
    .find(({ path }) => path === requestedRepo)?.item
  const scopedWorktrees = worktrees.filter((item) => item.repositoryId === repository?.id)
  const worktreePaths = await Promise.all(scopedWorktrees.map((item) => canonical(item.path)))
  const worktree = scopedWorktrees
    .map((item, index) => ({ item, path: worktreePaths[index] }))
    .reverse()
    .find(({ path }) => path === requestedPath)?.item
  if (!repository || !worktree || worktree.isMain || requestedPath === requestedRepo)
    return undefined
  const membership = await getWorktreeList(repository.path)
  const membershipPaths = await Promise.all(membership.map((item) => canonical(item.path)))
  const registered = membershipPaths.includes(requestedPath)
  if (!registered) {
    // A stale record may already have disappeared from git's list. Its absent
    // directory is still safe to forget, but never authorizes deleting a path.
    if (!worktree.prunable || existsSync(path)) return undefined
  }
  return { worktree, repository }
}
