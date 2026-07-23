import { create } from 'zustand'
import type { Repository, Worktree, AppSettings, WorktreeStatus, ScanProgress } from '@worktree/contracts'

interface AppState {
  view: 'onboarding' | 'dashboard' | 'settings'
  settings: AppSettings | null
  repositories: Repository[]
  worktrees: Worktree[]
  statuses: Record<string, WorktreeStatus>
  scanProgress: ScanProgress | null
  selectedRepositoryId: string | null
  setView: (view: AppState['view']) => void
  setSettings: (settings: AppSettings) => void
  setRepositories: (repositories: Repository[]) => void
  setWorktrees: (worktrees: Worktree[]) => void
  setStatuses: (statuses: WorktreeStatus[]) => void
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
  scanProgress: null,
  selectedRepositoryId: null,

  setView: (view) => set({ view }),
  setSettings: (settings) => set({ settings }),
  setRepositories: (repositories) => set({ repositories }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setStatuses: (statuses) =>
    set({
      statuses: statuses.reduce(
        (acc, status) => {
          acc[status.worktreeId] = status
          return acc
        },
        {} as Record<string, WorktreeStatus>
      ),
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
