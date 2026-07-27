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
})
export type Repository = z.infer<typeof repositorySchema>

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
  behindCommits: z.array(worktreeCommitSchema).default([]),
  baseBranch: z.string(),
})
export type WorktreeDetails = z.infer<typeof worktreeDetailsSchema>
