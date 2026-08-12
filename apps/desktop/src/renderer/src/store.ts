import { create } from 'zustand'
import type {
  Repository,
  Worktree,
  AppSettings,
  WorktreeStatus,
  WorktreeDiskUsage,
  ScanProgress,
} from '@worktree/contracts'

interface AppState {
  view: 'onboarding' | 'dashboard' | 'settings'
  settings: AppSettings | null
  repositories: Repository[]
  worktrees: Worktree[]
  statuses: Record<string, WorktreeStatus>
  /** Measured on demand, keyed by worktree id; absent until a project is opened. */
  diskUsage: Record<string, WorktreeDiskUsage>
  scanProgress: ScanProgress | null
  selectedRepositoryId: string | null
  setView: (view: AppState['view']) => void
  setSettings: (settings: AppSettings) => void
  setRepositories: (repositories: Repository[]) => void
  setWorktrees: (worktrees: Worktree[]) => void
  setStatuses: (statuses: WorktreeStatus[], scopeWorktreeIds?: string[]) => void
  setStatus: (worktreeId: string, status: WorktreeStatus) => void
  removeStatuses: (worktreeIds: string[]) => void
  setDiskUsage: (usage: WorktreeDiskUsage) => void
  removeDiskUsage: (worktreeIds: string[]) => void
  applyBranchChange: (worktreeId: string, branch: string) => void
  updateRepository: (repository: Repository) => void
  setScanProgress: (progress: AppState['scanProgress']) => void
  setSelectedRepositoryId: (id: string | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'onboarding',
  settings: null,
  repositories: [],
  worktrees: [],
  statuses: {},
  diskUsage: {},
  scanProgress: null,
  selectedRepositoryId: null,

  setView: (view) => set({ view }),
  setSettings: (settings) => set({ settings }),
  setRepositories: (repositories) => set({ repositories }),
  setWorktrees: (worktrees) => set({ worktrees }),
  // `scopeWorktreeIds` is the set of worktrees the caller actually asked about.
  // Statuses outside it are left alone, so refreshing one project never blanks
  // out the rows of a project that is mid-refresh in another tab of the UI.
  // Omitting it replaces the whole map (a full, all-projects load).
  setStatuses: (statuses, scopeWorktreeIds) =>
    set((state) => {
      const incoming: Record<string, WorktreeStatus> = {}
      for (const status of statuses) incoming[status.worktreeId] = status
      if (!scopeWorktreeIds) return { statuses: incoming }

      const scoped = new Set(scopeWorktreeIds)
      const kept: Record<string, WorktreeStatus> = {}
      for (const [worktreeId, status] of Object.entries(state.statuses)) {
        if (!scoped.has(worktreeId)) kept[worktreeId] = status
      }
      return { statuses: { ...kept, ...incoming } }
    }),
  // Replace one worktree's status outright. Targeted refreshes must not merge:
  // fields the fresh status omits (a `pullRequest` that no longer applies after
  // checking the base branch back out) would otherwise survive the update.
  setStatus: (worktreeId, status) =>
    set((state) => ({ statuses: { ...state.statuses, [worktreeId]: status } })),
  removeStatuses: (worktreeIds) =>
    set((state) => {
      const drop = new Set(worktreeIds)
      const next: Record<string, WorktreeStatus> = {}
      for (const [worktreeId, status] of Object.entries(state.statuses)) {
        if (!drop.has(worktreeId)) next[worktreeId] = status
      }
      return { statuses: next }
    }),
  setDiskUsage: (usage) =>
    set((state) => ({ diskUsage: { ...state.diskUsage, [usage.worktreeId]: usage } })),
  removeDiskUsage: (worktreeIds) =>
    set((state) => {
      const drop = new Set(worktreeIds)
      const next: Record<string, WorktreeDiskUsage> = {}
      for (const [worktreeId, usage] of Object.entries(state.diskUsage)) {
        if (!drop.has(worktreeId)) next[worktreeId] = usage
      }
      return { diskUsage: next }
    }),
  // Show a branch switch the instant it is known — before the targeted refresh,
  // which fetches the base ref over the network and can take seconds. The PR
  // goes with it: it described the branch we just left, so keeping it on screen
  // until the refresh lands is showing a badge we already know is wrong.
  applyBranchChange: (worktreeId, branch) =>
    set((state) => {
      const current = state.statuses[worktreeId]
      if (!current) return {}
      const { pullRequest: _staleForNewBranch, ...withoutPullRequest } = current
      return {
        statuses: {
          ...state.statuses,
          [worktreeId]: {
            ...withoutPullRequest,
            branch,
            detached: branch === 'HEAD',
            hasOpenPR: false,
          },
        },
      }
    }),
  updateRepository: (repository) =>
    set({
      repositories: get().repositories.map((r) =>
        r.id === repository.id ? repository : r
      ),
    }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setSelectedRepositoryId: (selectedRepositoryId) => set({ selectedRepositoryId }),
}))
