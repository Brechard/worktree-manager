import type { Repository } from '@worktree/contracts'

/**
 * Fold a freshly scanned repository into the one the user already configured.
 *
 * Scans run on every launch and on every "Rescan all", so this is the gate that
 * decides which settings survive. It starts from the *saved* repository and
 * lets discovery refresh only the facts it genuinely observes on disk — the
 * opposite of listing which settings to carry over. That ordering is the point:
 * an allowlist silently drops any setting added to `Repository` later, which is
 * how a configured cleanup command disappeared on the next app start.
 */
export function mergeDiscoveredRepository(
  discovered: Repository,
  previous: Repository | undefined
): Repository {
  if (!previous) return discovered
  return {
    // Everything the user configured, including settings added after this was
    // written, survives by default.
    ...previous,
    // Facts a scan actually establishes.
    id: discovered.id,
    name: discovered.name,
    path: discovered.path,
    ...(discovered.remoteUrl ? { remoteUrl: discovered.remoteUrl } : {}),
    // Discovery reads the repo's default branch, which is better than a stale
    // saved value; it falls back to what was saved when detection fails.
    baseBranch: discovered.baseBranch || previous.baseBranch,
    // A token the user pasted outranks anything re-derived from the remote.
    provider: previous.provider?.personalAccessToken
      ? previous.provider
      : (discovered.provider ?? previous.provider),
    // A picked image outranks an auto-detected one.
    imageUrl: previous.imageUrl ?? discovered.imageUrl,
  }
}
