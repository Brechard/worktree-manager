import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  Repository,
  Worktree,
  ScanResult,
  WorktreeStatus,
  WorktreeDetails,
  SafetyResult,
  ScanProgress,
  DetectedToken,
  ProviderConfig,
  ProviderType,
  WorktreeStatusesResult,
  SyncBaseMode,
  SyncTarget,
  SyncBaseResult,
  CommandResult,
  ProjectActionMode,
  WorktreeDiskUsage,
  ReclaimSpaceResult,
} from '@worktree/contracts'

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('set-settings', settings),

  getRepositories: (): Promise<Repository[]> => ipcRenderer.invoke('get-repositories'),
  setRepositories: (repositories: Repository[]): Promise<void> =>
    ipcRenderer.invoke('set-repositories', repositories),

  getWorktrees: (): Promise<Worktree[]> => ipcRenderer.invoke('get-worktrees'),
  setWorktrees: (worktrees: Worktree[]): Promise<void> =>
    ipcRenderer.invoke('set-worktrees', worktrees),

  discoverWorktrees: (options: {
    roots: string[]
    maxDepth?: number
  }): Promise<ScanResult & { cancelled: boolean }> =>
    ipcRenderer.invoke('discover-worktrees', options),
  cancelScan: (): Promise<void> => ipcRenderer.invoke('cancel-scan'),

  getWorktreeStatuses: (args: {
    worktrees: Worktree[]
    repositories: Repository[]
    /** Echoed back on the progress events so concurrent refreshes stay apart. */
    scopeId?: string
  }): Promise<WorktreeStatusesResult> => ipcRenderer.invoke('get-worktree-statuses', args),

  getWorktreeStatus: (args: {
    worktree: Worktree
    repository: Repository
  }): Promise<WorktreeStatus> => ipcRenderer.invoke('get-worktree-status', args),

  watchWorktreeHeads: (args: { worktrees: Worktree[] }): Promise<number> =>
    ipcRenderer.invoke('watch-worktree-heads', args),

  onWorktreeHeadChanged: (
    callback: (change: { worktreeId: string; branch: string; headCommit?: string }) => void
  ): (() => void) => {
    const listener = (
      _: unknown,
      change: { worktreeId: string; branch: string; headCommit?: string }
    ) => callback(change)
    ipcRenderer.on('worktree-head-changed', listener)
    return () => ipcRenderer.removeListener('worktree-head-changed', listener)
  },

  getWorktreeBranches: (args: {
    worktrees: Worktree[]
  }): Promise<{ worktreeId: string; branch: string }[]> =>
    ipcRenderer.invoke('get-worktree-branches', args),

  getWorktreeDetails: (args: {
    worktree: Worktree
    repository: Repository
  }): Promise<WorktreeDetails> => ipcRenderer.invoke('get-worktree-details', args),

  evaluateSafety: (args: { worktree: Worktree; status: WorktreeStatus }): Promise<SafetyResult> =>
    ipcRenderer.invoke('evaluate-safety', args),

  getFileDiff: (args: {
    path: string
    filePath: string
    staged?: boolean
    untracked?: boolean
    fullContext?: boolean
  }): Promise<string> => ipcRenderer.invoke('get-file-diff', args),

  discardFile: (args: {
    path: string
    filePath: string
    untracked?: boolean
  }): Promise<{ success: boolean; output: string }> => ipcRenderer.invoke('discard-file', args),

  pushWorktree: (path: string): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('push-worktree', path),

  checkoutBranch: (args: {
    path: string
    branch: string
  }): Promise<{ success: boolean; output: string }> => ipcRenderer.invoke('checkout-branch', args),

  mergeBranch: (args: {
    path: string
    branch: string
    mode: 'merge' | 'no-ff' | 'squash' | 'rebase'
  }): Promise<{ success: boolean; output: string }> => ipcRenderer.invoke('merge-branch', args),

  updateBaseBranch: (args: {
    path: string
    baseBranch: string
  }): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('update-base-branch', args),

  runWorktreeCleanup: (args: {
    command: string
    worktreePath: string
    repoPath: string
    branch?: string
    repoName?: string
    timeoutSeconds?: number
  }): Promise<CommandResult> => ipcRenderer.invoke('run-worktree-cleanup', args),

  runProjectAction: (args: {
    command: string
    worktreePath: string
    repoPath: string
    branch?: string
    repoName?: string
    /** Relative to the worktree root; where the command should run. */
    subdirectory?: string
    mode: ProjectActionMode
    timeoutSeconds?: number
    label?: string
  }): Promise<CommandResult> => ipcRenderer.invoke('run-project-action', args),

  syncWithBase: (args: {
    path: string
    baseBranch: string
    /** Which ref to bring in; defaults to the base branch. */
    target?: SyncTarget
    mode?: SyncBaseMode
  }): Promise<SyncBaseResult> => ipcRenderer.invoke('sync-with-base', args),

  commitWorktree: (args: {
    path: string
    message: string
    all?: boolean
  }): Promise<{ success: boolean; output: string }> => ipcRenderer.invoke('commit-worktree', args),

  measureWorktreeDisk: (args: {
    worktreeId: string
    path: string
    /** Ignore the cached measurement and walk the tree again. */
    refresh?: boolean
  }): Promise<WorktreeDiskUsage> => ipcRenderer.invoke('measure-worktree-disk', args),

  reclaimWorktreeSpace: (args: {
    path: string
    /** Worktree-relative directories, as measured. */
    entries: string[]
  }): Promise<ReclaimSpaceResult> => ipcRenderer.invoke('reclaim-worktree-space', args),

  openDirectoryDialog: (): Promise<string[]> => ipcRenderer.invoke('open-directory-dialog'),

  openInEditor: (args: {
    path: string
    editor?: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('open-in-editor', args),
  openInTerminal: (args: {
    path: string
    terminal?: string
    /** Project subdirectory to open instead of the worktree root. */
    subdirectory?: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('open-in-terminal', args),
  openInFileManager: (path: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-in-file-manager', path),
  removeWorktree: (args: {
    path: string
    repoPath: string
    missing?: boolean
    branch?: string
    deleteBranch?: boolean
    /** Delete outright rather than move to Trash. */
    permanent?: boolean
    /** Required for the main process to revalidate a permanent deletion. */
    worktree?: Worktree
    repository?: Repository
    expectedStatus?: WorktreeStatus
  }): Promise<{ success: boolean; error?: string; branchError?: string }> =>
    ipcRenderer.invoke('remove-worktree', args),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  encryptToken: (token: string): Promise<string> => ipcRenderer.invoke('encrypt-token', token),
  decryptToken: (encrypted: string): Promise<string> =>
    ipcRenderer.invoke('decrypt-token', encrypted),

  detectProviderToken: (provider: ProviderType): Promise<DetectedToken | undefined> =>
    ipcRenderer.invoke('detect-provider-token', provider),
  parseRemoteProvider: (remoteUrl: string): Promise<ProviderConfig | undefined> =>
    ipcRenderer.invoke('parse-remote-provider', remoteUrl),

  getRepoBranches: (path: string): Promise<{ branches: string[]; defaultBranch?: string }> =>
    ipcRenderer.invoke('get-repo-branches', path),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  isDev: (): Promise<boolean> => ipcRenderer.invoke('is-dev'),

  getAvailableEditors: (): Promise<string[]> => ipcRenderer.invoke('get-available-editors'),

  getEditorIcons: (editorIds: string[]): Promise<Record<string, string>> =>
    ipcRenderer.invoke('get-editor-icons', editorIds),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_: unknown, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },

  onStatusProgress: (
    callback: (progress: { scopeId?: string; current: number; total: number }) => void
  ): (() => void) => {
    const listener = (_: unknown, progress: { scopeId?: string; current: number; total: number }) =>
      callback(progress)
    ipcRenderer.on('status-progress', listener)
    return () => ipcRenderer.removeListener('status-progress', listener)
  },

  onBaseStatusProgress: (
    callback: (progress: { scopeId?: string; current: number; total: number }) => void
  ): (() => void) => {
    const listener = (_: unknown, progress: { scopeId?: string; current: number; total: number }) =>
      callback(progress)
    ipcRenderer.on('base-status-progress', listener)
    return () => ipcRenderer.removeListener('base-status-progress', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
