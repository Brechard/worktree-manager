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

export const worktreeSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  path: z.string(),
  branch: z.string(),
  headCommit: z.string().optional(),
  isMain: z.boolean().default(false),
  lastModified: z.number().optional(),
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
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const safetyResultSchema = z.object({
  worktreeId: z.string(),
  safe: z.boolean(),
  reasons: z.array(z.string()),
})
export type SafetyResult = z.infer<typeof safetyResultSchema>

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
