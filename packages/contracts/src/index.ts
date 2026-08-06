import { z } from 'zod'

export const providerTypeSchema = z.enum(['github', 'azure'])
export type ProviderType = z.infer<typeof providerTypeSchema>

export const providerConfigSchema = z.object({
  type: providerTypeSchema,
  organization: z.string().optional(),
  project: z.string().optional(),
  repository: z.string(),
  personalAccessToken: z.string().optional(),
  /** How the provider fields were obtained */
  source: z.enum(['remote', 'manual']).optional(),
})
export type ProviderConfig = z.infer<typeof providerConfigSchema>

export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  baseBranch: z.string().default('main'),
  remoteUrl: z.string().optional(),
  provider: providerConfigSchema.optional(),
  /** Pin to top of project list */
  favorite: z.boolean().default(false),
  /** Per-project editor id (falls back to app defaultEditor) */
  preferredEditor: z.string().optional(),
  /** Optional project image URL or data URL */
  imageUrl: z.string().optional(),
  /**
   * Shell command run inside a worktree just before it is deleted, to release
   * whatever that worktree allocated outside git — per-worktree Docker stacks,
   * volumes, ports, caches. Runs with WORKTREE_PATH / WORKTREE_BRANCH /
   * REPO_PATH / REPO_NAME in the environment.
   */
  preDeleteCommand: z.string().optional(),
  /** Seconds the pre-delete command may run before it is killed. */
  preDeleteTimeoutSeconds: z.number().optional(),
})
export type Repository = z.infer<typeof repositorySchema>

export const cleanupResultSchema = z.object({
  success: z.boolean(),
  /** Combined stdout + stderr, trimmed, for showing back to the user. */
  output: z.string(),
  exitCode: z.number().optional(),
  timedOut: z.boolean().optional(),
})
export type CleanupResult = z.infer<typeof cleanupResultSchema>

export const worktreeSortSchema = z.enum(['activity', 'name', 'safety'])
export type WorktreeSort = z.infer<typeof worktreeSortSchema>

export const worktreeSortDirectionSchema = z.enum(['asc', 'desc'])
export type WorktreeSortDirection = z.infer<typeof worktreeSortDirectionSchema>

export const worktreeSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  path: z.string(),
  branch: z.string(),
  headCommit: z.string().optional(),
  isMain: z.boolean().default(false),
  /** Latest known activity: changed-file mtime, commit time, or directory mtime. */
  lastModified: z.number().optional(),
  /** Working tree directory is gone; git still has a (prunable) record for it. */
  prunable: z.boolean().default(false),
  /** Why the worktree is considered stale (missing dir / gitdir), when prunable. */
  prunableReason: z.string().optional(),
})
export type Worktree = z.infer<typeof worktreeSchema>

export const prStateSchema = z.enum(['open', 'closed', 'merged', 'draft'])
export type PrState = z.infer<typeof prStateSchema>

export const pullRequestSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  state: prStateSchema,
  branch: z.string(),
  /** Branch the PR targets. Often differs from the repository's configured base
   *  (e.g. a long-lived release branch), which is why a merged PR can still read
   *  as unmerged against the base. */
  targetBranch: z.string().optional(),
})
export type PullRequest = z.infer<typeof pullRequestSchema>

/**
 * A pull request is a proposal to merge *this* branch into the base, so the
 * base branch itself never has one of its own, and a detached HEAD has no
 * branch to look one up by. Asking the provider anyway matches on "most recent
 * PR whose head is this branch", which for a trunk returns whatever release-
 * style PR once shipped from it — and then pins that stale badge to the row
 * forever. Shared so the main-process lookup and the renderer's badge agree.
 */
export function branchCanHavePullRequest(
  branch: string | undefined,
  baseBranch: string
): boolean {
  if (!branch || branch === 'HEAD') return false
  return branch !== baseBranch
}

export const baseBranchSyncStateSchema = z.enum([
  'current',
  'behind',
  'ahead',
  'diverged',
  'local-only',
  'remote-only',
  'unknown',
])
export type BaseBranchSyncState = z.infer<typeof baseBranchSyncStateSchema>

/** Freshness of a repository's local base branch relative to origin. */
export const repositoryBaseStatusSchema = z.object({
  repositoryId: z.string(),
  baseBranch: z.string(),
  state: baseBranchSyncStateSchema,
  localExists: z.boolean(),
  remoteExists: z.boolean(),
  ahead: z.number().int().nonnegative().default(0),
  behind: z.number().int().nonnegative().default(0),
  fetchedAt: z.number().optional(),
  fetchError: z.string().optional(),
})
export type RepositoryBaseStatus = z.infer<typeof repositoryBaseStatusSchema>

export const worktreeStatusSchema = z.object({
  worktreeId: z.string(),
  dirty: z.boolean().default(false),
  staged: z.boolean().default(false),
  ahead: z.number().default(0),
  behind: z.number().default(0),
  unpushed: z.number().default(0),
  mergedIntoBase: z.boolean().default(false),
  baseBranch: z.string(),
  /** Set when the base-branch fetch failed, so `mergedIntoBase` was decided
   *  against a possibly-stale ref (or no ref at all) and cannot be trusted. */
  baseFetchError: z.string().optional(),
  hasOpenPR: z.boolean().default(false),
  pullRequest: pullRequestSchema.optional(),
  lastFetched: z.number().optional(),
  /** Commits on the freshly-fetched base ref that this branch has not integrated
   *  yet. This is the "base moved on without you" count, and is unrelated to
   *  `behind`, which compares against this branch's own upstream. */
  behindBase: z.number().int().nonnegative().default(0),
  /** Commits on this branch that the base ref does not have. */
  aheadBase: z.number().int().nonnegative().default(0),
  /** Display form of the ref the two counts above were measured against
   *  (`origin/main` when the fetch worked, `main` when only a local ref exists). */
  baseRef: z.string().optional(),
  /** Merge commits on this branch that the base ref does not have. A rebase
   *  replays them one by one, which is how a branch that has merged the base in
   *  before ends up re-fighting conflicts it already settled. */
  mergeCommits: z.number().int().nonnegative().default(0),
  /** Live branch name at refresh time ('HEAD' when detached); overrides the
   *  possibly-stale value stored on the worktree from the last full scan. */
  branch: z.string().optional(),
  /** Live short HEAD commit at refresh time. */
  headCommit: z.string().optional(),
  /** Whether HEAD is detached right now. */
  detached: z.boolean().optional(),
})
export type WorktreeStatus = z.infer<typeof worktreeStatusSchema>

export const worktreeStatusesResultSchema = z.object({
  statuses: z.array(worktreeStatusSchema),
  baseStatuses: z.array(repositoryBaseStatusSchema),
})
export type WorktreeStatusesResult = z.infer<typeof worktreeStatusesResultSchema>

export const scanProgressSchema = z.object({
  total: z.number().int(),
  current: z.number().int(),
  currentPath: z.string().optional(),
  found: z.number().int().default(0),
})
export type ScanProgress = z.infer<typeof scanProgressSchema>

export const scanResultSchema = z.object({
  repositories: z.array(repositorySchema),
  worktrees: z.array(worktreeSchema),
})
export type ScanResult = z.infer<typeof scanResultSchema>

export const appSettingsSchema = z.object({
  watchedDirectories: z.array(z.string()).default([]),
  excludedPaths: z
    .array(z.string())
    .default([
      '~/.claude/plugins/cache',
      '~/.codex/plugins/cache',
      '~/.devin/plugins/cache',
    ]),
  defaultEditor: z.string().default('cursor'),
  defaultTerminal: z.string().optional(),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Optional global PATs used when a repo has no token of its own */
  githubToken: z.string().optional(),
  azureToken: z.string().optional(),
  lastSelectedRepositoryId: z.string().optional(),
  /** Worktree list ordering; defaults to most recently active first. */
  worktreeSort: worktreeSortSchema.default('activity'),
  worktreeSortDirection: worktreeSortDirectionSchema.default('desc'),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const safetyResultSchema = z.object({
  worktreeId: z.string(),
  safe: z.boolean(),
  reasons: z.array(z.string()),
})
export type SafetyResult = z.infer<typeof safetyResultSchema>

/**
 * The single source of truth for "is this worktree safe to remove". It lives in
 * contracts because both the main process (delete confirmation) and the
 * renderer (badge, filter, grouping) need it, and they drifted when each kept
 * its own copy.
 *
 * Only content checks live here. `isMain` / `prunable` are deliberately left to
 * callers: the delete dialog handles those cases before it ever asks, while the
 * list uses them to pick a group rather than a safety verdict.
 */
export function worktreeSafetyReasons(worktree: Worktree, status: WorktreeStatus): string[] {
  const reasons: string[] = []
  // Live branch from the refresh, not the value captured at the last full scan,
  // which goes stale as soon as someone checks out something else.
  const branch = status.branch ?? worktree.branch

  if (status.dirty || status.staged) reasons.push('Has uncommitted changes')
  if (status.ahead > 0 || status.unpushed > 0) {
    reasons.push(`${status.ahead > 0 ? status.ahead : status.unpushed} unpushed commit(s)`)
  }
  if (!status.mergedIntoBase && branch !== status.baseBranch && branch !== 'HEAD') {
    reasons.push(
      status.baseFetchError
        ? `Could not confirm the branch is merged into ${status.baseBranch} (fetch failed)`
        : `Branch not merged into ${status.baseBranch}`
    )
  }
  if (status.hasOpenPR) reasons.push('Has an open pull request')

  return reasons
}

export function isSafeToDelete(worktree: Worktree, status?: WorktreeStatus): boolean {
  if (worktree.isMain || worktree.prunable || !status) return false
  return worktreeSafetyReasons(worktree, status).length === 0
}

export const detectedTokenSchema = z.object({
  provider: providerTypeSchema,
  token: z.string(),
  source: z.string(),
})
export type DetectedToken = z.infer<typeof detectedTokenSchema>

export const worktreeStatusFileSchema = z.object({
  path: z.string(),
  status: z.string(),
})
export type WorktreeStatusFile = z.infer<typeof worktreeStatusFileSchema>

export const worktreeCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
})
export type WorktreeCommit = z.infer<typeof worktreeCommitSchema>

export const worktreeDetailsSchema = z.object({
  worktreeId: z.string(),
  dirtyFiles: z.array(worktreeStatusFileSchema).default([]),
  stagedFiles: z.array(worktreeStatusFileSchema).default([]),
  untrackedFiles: z.array(worktreeStatusFileSchema).default([]),
  unpushedCommits: z.array(worktreeCommitSchema).default([]),
  /** Commits this branch is missing from its own upstream (`origin/<branch>`). */
  behindCommits: z.array(worktreeCommitSchema).default([]),
  /** Commits this branch is missing from the base ref — what a sync would bring in. */
  baseBehindCommits: z.array(worktreeCommitSchema).default([]),
  baseBranch: z.string(),
  /** Display form of the ref `baseBehindCommits` was measured against. */
  baseRef: z.string().optional(),
})
export type WorktreeDetails = z.infer<typeof worktreeDetailsSchema>

export const syncBaseModeSchema = z.enum(['rebase', 'merge'])
export type SyncBaseMode = z.infer<typeof syncBaseModeSchema>

/**
 * Which way to bring the base in, and why. Rebase is the nicer default — until
 * the branch's own shape says otherwise, at which point picking it is a trap
 * the user only finds out about by hitting conflicts. Both signals below mean
 * "the commits are not yours alone to rewrite":
 *  - merge commits from an earlier sync, which a rebase replays individually
 *  - an open PR, which means the commits are already pushed and reviewed
 *
 * Shared so the button label, its tooltip and the git menu all agree.
 */
export function recommendedSyncMode(
  status: Pick<WorktreeStatus, 'hasOpenPR' | 'mergeCommits'> | undefined,
  baseRef: string
): { mode: SyncBaseMode; reason?: string } {
  if (!status) return { mode: 'rebase' }
  if (status.mergeCommits > 0) {
    return {
      mode: 'merge',
      reason: `This branch already contains ${status.mergeCommits} merge commit${status.mergeCommits === 1 ? '' : 's'}. Rebasing replays each of them onto ${baseRef}, which re-opens conflicts you already settled.`,
    }
  }
  if (status.hasOpenPR) {
    return {
      mode: 'merge',
      reason:
        'This branch has an open pull request, so its commits are already pushed. Rebasing would rewrite them.',
    }
  }
  return { mode: 'rebase' }
}

/**
 * What a base sync actually did. Every value other than `restore-conflict`
 * leaves the worktree in a settled state: either the sync landed, or nothing
 * changed at all. `conflict` specifically means the operation was rolled back.
 */
export const syncBaseOutcomeSchema = z.enum([
  /** The branch already contains everything on the base ref. */
  'up-to-date',
  /** The rebase/merge landed and any stashed changes were restored. */
  'synced',
  /** Conflicts hit; the operation was aborted and the worktree restored. */
  'conflict',
  /** Preconditions failed (detached HEAD, another rebase in progress, …). Nothing ran. */
  'blocked',
  /** The sync landed but re-applying the stashed changes conflicted; the stash is kept. */
  'restore-conflict',
])
export type SyncBaseOutcome = z.infer<typeof syncBaseOutcomeSchema>

export const syncBaseResultSchema = z.object({
  success: z.boolean(),
  outcome: syncBaseOutcomeSchema,
  mode: syncBaseModeSchema,
  /** Display form of the ref that was synced from, e.g. `origin/main`. */
  baseRef: z.string().optional(),
  /** One-line summary, followed by detail lines. Safe to show verbatim. */
  output: z.string(),
  conflictedFiles: z.array(z.string()).default([]),
  /** The mode that would actually work, when the attempted one did not — set
   *  after a conflicting rebase that a merge is proven to resolve cleanly. */
  recommendedMode: syncBaseModeSchema.optional(),
  /** Ref pinned at the pre-sync HEAD so the previous state stays reachable. */
  backupRef: z.string().optional(),
  /** Short pre-sync HEAD, for the recovery hint. */
  previousHead: z.string().optional(),
  /** Uncommitted work was stashed for the duration of the operation. */
  stashed: z.boolean().default(false),
})
export type SyncBaseResult = z.infer<typeof syncBaseResultSchema>
