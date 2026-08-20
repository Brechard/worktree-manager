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

/** Icons offered for a custom action, so a row of buttons stays readable. */
export const projectActionIconSchema = z.enum([
  'play',
  'terminal',
  'rocket',
  'hammer',
  'beaker',
  'database',
  'globe',
  'zap',
])
export type ProjectActionIcon = z.infer<typeof projectActionIconSchema>

/**
 * Where a custom action runs. `terminal` opens a new window in the user's
 * terminal — the only sane home for a dev server or a simulator, which keep
 * printing and have to be interruptible. `background` runs it inside the app
 * and reports back when it exits, for one-shot commands.
 */
export const projectActionModeSchema = z.enum(['terminal', 'background'])
export type ProjectActionMode = z.infer<typeof projectActionModeSchema>

export const projectActionSchema = z.object({
  id: z.string(),
  /** Short button label, e.g. "Dev" or "Sim". */
  label: z.string(),
  command: z.string(),
  icon: projectActionIconSchema.default('play'),
  mode: projectActionModeSchema.default('terminal'),
  /** Seconds a `background` action may run before it is killed. */
  timeoutSeconds: z.number().optional(),
})
export type ProjectAction = z.infer<typeof projectActionSchema>

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
  /**
   * Where day-to-day work happens inside a worktree, relative to its root — the
   * `clubtidy/` of a repo whose app lives one level down. Terminals and custom
   * actions start here instead of the worktree root.
   */
  workingSubdirectory: z.string().optional(),
  /** Per-project buttons on every worktree row (`npm run dev:local`, a sim script, …). */
  actions: z.array(projectActionSchema).default([]),
})
export type Repository = z.infer<typeof repositorySchema>

/** What running a project-defined shell command did. */
export const commandResultSchema = z.object({
  success: z.boolean(),
  /** Combined stdout + stderr, trimmed, for showing back to the user. */
  output: z.string(),
  exitCode: z.number().optional(),
  timedOut: z.boolean().optional(),
})
export type CommandResult = z.infer<typeof commandResultSchema>

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
export function branchCanHavePullRequest(branch: string | undefined, baseBranch: string): boolean {
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
  /** Untracked files are not `dirty` in porcelain's tracked-file columns, but
   *  deleting them can lose the only copy of real work. */
  hasUntracked: z.boolean().default(false),
  /** Git could not safely inspect the working tree. Cleanup fails closed while set. */
  statusReadError: z.string().optional(),
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
  /** Display form of this branch's own upstream (`origin/<branch>`), when it has
   *  one. `ahead`/`behind` are measured against it. */
  upstreamRef: z.string().optional(),
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
    .default(['~/.claude/plugins/cache', '~/.codex/plugins/cache', '~/.devin/plugins/cache']),
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

  if (status.statusReadError) reasons.push('Could not inspect working tree safely')
  if (status.dirty || status.staged) reasons.push('Has uncommitted changes')
  if (status.hasUntracked) reasons.push('Has untracked files')
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

/** What kind of thing a regenerable directory is, for the "what am I deleting" line. */
export const reclaimableKindSchema = z.enum(['dependencies', 'build', 'cache', 'test'])
export type ReclaimableKind = z.infer<typeof reclaimableKindSchema>

export const reclaimableEntrySchema = z.object({
  /** Relative to the worktree root, e.g. `apps/desktop/node_modules`. */
  path: z.string(),
  kind: reclaimableKindSchema,
  bytes: z.number().nonnegative(),
})
export type ReclaimableEntry = z.infer<typeof reclaimableEntrySchema>

/**
 * What one worktree costs on disk. Measured on demand rather than at scan time:
 * it walks the whole tree, which is far too expensive to do on every refresh.
 */
export const worktreeDiskUsageSchema = z.object({
  worktreeId: z.string(),
  path: z.string(),
  totalBytes: z.number().nonnegative(),
  /** Estimated part of the total held by generated directories that rebuild
   *  from source. Shared blocks (hardlinks/APFS clones) may make actual freed
   *  space lower than this allocated-size estimate. */
  reclaimableBytes: z.number().nonnegative(),
  entries: z.array(reclaimableEntrySchema).default([]),
  measuredAt: z.number(),
  error: z.string().optional(),
})
export type WorktreeDiskUsage = z.infer<typeof worktreeDiskUsageSchema>

export const reclaimSpaceResultSchema = z.object({
  freedBytes: z.number().nonnegative(),
  removed: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
})
export type ReclaimSpaceResult = z.infer<typeof reclaimSpaceResultSchema>

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Short human size, e.g. `1.4 GB`. Shared so every surface rounds the same way. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const decimals = unit >= 3 ? (value < 10 ? 2 : 1) : value < 10 && unit > 1 ? 1 : 0
  return `${value.toFixed(decimals)} ${BYTE_UNITS[unit]}`
}

/**
 * Whether a worktree's branch has landed, and therefore whether the worktree
 * itself is finished with.
 *
 * `ready` is the uncontroversial case: merged, clean, pushed, no open PR.
 * `review` is the one that used to be invisible — the branch is merged, so the
 * work is safe in the base, but something is still sitting in the working tree
 * (build residue, a local config edit, a commit that was never pushed because
 * the PR was squash-merged). Those are exactly the worktrees that survive
 * longest, since nothing ever offers to remove them; surfacing them with their
 * reasons and leaving them unchecked is what makes them reclaimable at all.
 */
export type CleanupCandidateKind = 'ready' | 'review'

export interface CleanupCandidate {
  worktree: Worktree
  kind: CleanupCandidateKind
  /** Live branch name, so the list never labels a row with a stale checkout. */
  branch: string
  /** Why it needs a look; empty for `ready`. */
  reasons: string[]
}

export function cleanupCandidacy(
  worktree: Worktree,
  status: WorktreeStatus | undefined
): { kind: CleanupCandidateKind; branch: string; reasons: string[] } | undefined {
  if (worktree.isMain || worktree.prunable || !status) return undefined
  const branch = status.branch ?? worktree.branch
  if (branch === 'HEAD' || branch === status.baseBranch) return undefined
  // A merge we could not confirm is not a merge: the base ref may be stale or
  // missing entirely, and offering to delete on that basis loses work.
  if (status.baseFetchError || status.statusReadError) return undefined
  // Squash/rebase merges do not make the old branch HEAD an ancestor of base,
  // but a provider-confirmed merged PR into this exact base is equally strong
  // evidence that the branch landed. A PR into a release branch is not.
  const providerConfirmedLanded =
    status.pullRequest?.state === 'merged' &&
    status.pullRequest.targetBranch !== undefined &&
    status.pullRequest.targetBranch === status.baseBranch
  if (!status.mergedIntoBase && !providerConfirmedLanded) return undefined

  const reasons = worktreeSafetyReasons(worktree, {
    ...status,
    // The shared safety check only understands ancestry. Once the provider has
    // confirmed this branch landed in the configured base, give it that same
    // fact so "not merged" is not added back as a review reason.
    mergedIntoBase: status.mergedIntoBase || providerConfirmedLanded,
  })
  return reasons.length === 0
    ? { kind: 'ready', branch, reasons: [] }
    : { kind: 'review', branch, reasons }
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

/**
 * How to bring another ref's commits in. `ff` is the "just pull" case: it only
 * ever moves the branch pointer forward, so it is offered exactly when the
 * branch has nothing of its own to replay or preserve.
 */
export const syncBaseModeSchema = z.enum(['ff', 'rebase', 'merge'])
export type SyncBaseMode = z.infer<typeof syncBaseModeSchema>

/**
 * Which ref a sync brings in: this branch's own upstream (`origin/<branch>` —
 * commits pushed from somewhere else), or the repository's base branch.
 */
export const syncTargetSchema = z.enum(['upstream', 'base'])
export type SyncTarget = z.infer<typeof syncTargetSchema>

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

/** One ref with commits this branch has not got yet, and what to do about it. */
export interface UpdateOffer {
  target: SyncTarget
  /** Display form of the ref the commits come from, e.g. `origin/feature`. */
  ref: string
  /** Commits that ref has and this branch does not. */
  behind: number
  /** Commits this branch has that the ref does not — 0 means a plain pull works. */
  ahead: number
  /** What one click runs. */
  mode: SyncBaseMode
  /** Why that mode, when it is not the obvious one. */
  reason?: string
}

/**
 * Everything this worktree could bring in right now, most urgent first.
 *
 * Its own upstream comes first: those commits were pushed from somewhere else
 * (another machine, a colleague, a "merge from the web UI") and they belong on
 * this branch before anything else is layered on top. The base branch comes
 * second — that is catching up with where the project went, not with the branch
 * itself.
 *
 * Each offer carries the mode that actually suits it, which is what lets the
 * button say *pull*, *rebase* or *merge* rather than always naming one of them:
 *  - nothing of our own in the way (`ahead === 0`) → a fast-forward, i.e. a pull
 *  - otherwise the two histories diverged and something has to give, so the
 *    branch's shape decides between replaying our commits and merging theirs
 *
 * Shared so the button label, its dropdown, the git menu and the project
 * catch-up all describe the same operation.
 */
export function updateOffers(status: WorktreeStatus | undefined): UpdateOffer[] {
  if (!status || status.detached === true) return []
  const offers: UpdateOffer[] = []

  // A branch started from `origin/main` tracks it, and the primary worktree's
  // branch *is* it — in both cases the two refs are the same ref, and the base
  // offer below is the one that knows about pull requests and merge commits.
  const upstreamIsBase = status.upstreamRef !== undefined && status.upstreamRef === status.baseRef

  if (status.upstreamRef && status.behind > 0 && !upstreamIsBase) {
    offers.push({
      target: 'upstream',
      ref: status.upstreamRef,
      behind: status.behind,
      ahead: status.ahead,
      // A rebase here replays only the commits that were never pushed — the
      // published ones are exactly what it is replaying *onto* — so the "an
      // open PR means don't rewrite" rule that governs a base sync does not
      // apply. Merge commits still do: a rebase would replay each one.
      ...(status.ahead === 0
        ? { mode: 'ff' as const }
        : status.mergeCommits > 0
          ? {
              mode: 'merge' as const,
              reason: `This branch already contains ${status.mergeCommits} merge commit${status.mergeCommits === 1 ? '' : 's'}. Rebasing replays each of them, which re-opens conflicts you already settled.`,
            }
          : {
              mode: 'rebase' as const,
              reason: `This branch and ${status.upstreamRef} have both moved on, so a plain pull cannot work. Rebasing replays your ${status.ahead} local commit${status.ahead === 1 ? '' : 's'} on top of what was pushed.`,
            }),
    })
  }

  if (status.baseRef && status.behindBase > 0) {
    const suggested = recommendedSyncMode(status, status.baseRef)
    offers.push({
      target: 'base',
      ref: status.baseRef,
      behind: status.behindBase,
      ahead: status.aheadBase,
      ...(status.aheadBase === 0 ? { mode: 'ff' as const } : suggested),
    })
  }

  return offers
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
  /** Which ref was brought in — this branch's upstream or the base branch. */
  target: syncTargetSchema.default('base'),
  /** Display form of the ref that was synced from, e.g. `origin/main`. */
  baseRef: z.string().optional(),
  /** One-line summary, followed by detail lines. Safe to show verbatim. */
  output: z.string(),
  conflictedFiles: z.array(z.string()).default([]),
  /** The mode that would actually work, when the attempted one did not — set
   *  after a conflicting rebase that a merge is proven to resolve cleanly, and
   *  after a fast-forward that the two histories have diverged past. */
  recommendedMode: syncBaseModeSchema.optional(),
  /** Ref pinned at the pre-sync HEAD so the previous state stays reachable. */
  backupRef: z.string().optional(),
  /** Short pre-sync HEAD, for the recovery hint. */
  previousHead: z.string().optional(),
  /** Uncommitted work was stashed for the duration of the operation. */
  stashed: z.boolean().default(false),
})
export type SyncBaseResult = z.infer<typeof syncBaseResultSchema>
