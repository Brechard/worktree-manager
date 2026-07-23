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
} from '@worktree/contracts'

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('set-settings', settings),

  getRepositories: (): Promise<Repository[]> => ipcRenderer.invoke('get-repositories'),
  setRepositories: (repositories: Repository[]): Promise<void> =>
    ipcRenderer.invoke('set-repositories', repositories),

  getWorktrees: (): Promise<Worktree[]> => ipcRenderer.invoke('get-worktrees'),
  setWorktrees: (worktrees: Worktree[]): Promise<void> => ipcRenderer.invoke('set-worktrees', worktrees),

  discoverWorktrees: (options: {
    roots: string[]
    maxDepth?: number
  }): Promise<ScanResult & { cancelled: boolean }> =>
    ipcRenderer.invoke('discover-worktrees', options),
  cancelScan: (): Promise<void> => ipcRenderer.invoke('cancel-scan'),

  getWorktreeStatuses: (args: {
    worktrees: Worktree[]
    repositories: Repository[]
  }): Promise<WorktreeStatus[]> => ipcRenderer.invoke('get-worktree-statuses', args),

  getWorktreeDetails: (args: {
    worktree: Worktree
    repository: Repository
  }): Promise<WorktreeDetails> => ipcRenderer.invoke('get-worktree-details', args),

  evaluateSafety: (args: {
    worktree: Worktree
    status: WorktreeStatus
  }): Promise<SafetyResult> => ipcRenderer.invoke('evaluate-safety', args),

  openDirectoryDialog: (): Promise<string[]> => ipcRenderer.invoke('open-directory-dialog'),

  openInEditor: (args: { path: string; editor?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-in-editor', args),
  openInTerminal: (args: { path: string; terminal?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-in-terminal', args),
  openInFileManager: (path: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-in-file-manager', path),
  trashWorktree: (path: string): Promise<boolean> => ipcRenderer.invoke('trash-worktree', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  encryptToken: (token: string): Promise<string> => ipcRenderer.invoke('encrypt-token', token),
  decryptToken: (encrypted: string): Promise<string> => ipcRenderer.invoke('decrypt-token', encrypted),

  detectProviderToken: (provider: ProviderType): Promise<DetectedToken | undefined> =>
    ipcRenderer.invoke('detect-provider-token', provider),
  parseRemoteProvider: (remoteUrl: string): Promise<ProviderConfig | undefined> =>
    ipcRenderer.invoke('parse-remote-provider', remoteUrl),

  onScanProgress: (
    callback: (progress: ScanProgress) => void
  ): (() => void) => {
    const listener = (_: unknown, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('scan-progress', listener)
    return () => ipcRenderer.removeListener('scan-progress', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
