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
  patchStatus: (worktreeId: string, patch: Partial<WorktreeStatus>) => void
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
  // Merge a single worktree's status into the map without touching the others —
  // used for optimistic updates and targeted (single-worktree) refreshes so a
  // git action doesn't have to re-sync every worktree in every repo.
  patchStatus: (worktreeId, patch) =>
    set((state) => ({
      statuses: {
        ...state.statuses,
        [worktreeId]: { ...state.statuses[worktreeId], ...patch } as WorktreeStatus,
      },
    })),
  updateRepository: (repository) =>
    set({
      repositories: get().repositories.map((r) =>
        r.id === repository.id ? repository : r
      ),
    }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setSelectedRepositoryId: (selectedRepositoryId) => set({ selectedRepositoryId }),
}))
