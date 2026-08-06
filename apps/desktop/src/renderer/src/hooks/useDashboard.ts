import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  Repository,
  RepositoryBaseStatus,
  ScanProgress,
  Worktree,
  WorktreeSort,
  WorktreeSortDirection,
  WorktreeStatus,
} from '@worktree/contracts'
import { useAppStore } from '../store'
import { api } from '../api'
import { shortenPath } from '../lib/paths'
import { groupWorktrees, isSafeToDelete, sortWorktrees } from '../lib/worktreeSorting'
import { mergeDiscoveredRepository } from '../lib/repositories'

export function defaultDirectionFor(sort: WorktreeSort): WorktreeSortDirection {
  return sort === 'name' ? 'asc' : sort === 'activity' ? 'desc' : 'asc'
}

type Progress = { current: number; total: number }

/** Add or remove one id without touching the rest of the set's identity. */
function toggleId(ids: Set<string>, id: string, present: boolean): Set<string> {
  if (ids.has(id) === present) return ids
  const next = new Set(ids)
  if (present) next.add(id)
  else next.delete(id)
  return next
}

export interface UseDashboardReturn {
  repositories: Repository[]
  worktrees: Worktree[]
  statuses: Record<string, WorktreeStatus>
  scanProgress: ScanProgress | null
  /** Progress for the selected project only; other projects keep their own. */
  statusProgress: Progress | null
  baseStatusProgress: Progress | null
  /** True while the *selected* project is refreshing. */
  loading: boolean
  scanning: boolean
  refreshingIds: Set<string>
  /** Worktrees whose project cleanup hook is currently running. */
  cleaningIds: Set<string>
  baseStatuses: Record<string, RepositoryBaseStatus>
  /** True while the *selected* project's base branch is being updated. */
  baseUpdating: boolean
  /** Every project with a refresh or base update in flight, for the sidebar. */
  busyRepoIds: Set<string>
  /** Every project holding an undismissed error, for the sidebar. */
  erroredRepoIds: Set<string>
  selectedRepositoryId: string | null
  projectSearch: string
  setProjectSearch: (value: string) => void
  sortedRepos: Repository[]
  selectedRepo: Repository | null
  worktreeSections: ReturnType<typeof groupWorktrees>
  repoWorktrees: Worktree[]
  worktreeCountByRepo: Map<string, number>
  effectiveEditor: string
  sortMode: WorktreeSort
  sortDirection: WorktreeSortDirection
  filter: 'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'
  setFilter: (value: 'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe') => void
  search: string
  setSearch: (value: string) => void
  configRepoId: string | null
  setConfigRepoId: (value: string | null) => void
  /** The error belonging to the selected project (or a global one). */
  actionError: string | null
  setActionError: (value: string | null) => void
  setRepoError: (repositoryId: string, message: string | null) => void
  rescan: () => Promise<void>
  /** Refresh one project. Never touches any other project's data or spinners. */
  loadRepoStatuses: (repositoryId: string) => Promise<void>
  /** Refresh the selected project. */
  loadStatuses: () => Promise<void>
  updateRepoBase: (repositoryId: string) => Promise<void>
  updateSelectedBase: () => Promise<void>
  selectRepository: (id: string) => Promise<void>
  updateRepo: (id: string, patch: Partial<Repository>) => Promise<void>
  updateWorktreeSort: (
    nextSort: WorktreeSort,
    nextDirection: WorktreeSortDirection
  ) => Promise<void>
  onActionError: (message: string) => void
  onBranchChange: (worktreeId: string, branch: string) => void
  handleDelete: (w: Worktree) => Promise<void>
  refreshWorktreeStatus: (worktree: Worktree) => Promise<void>
  saveRepository: (repo: Repository) => Promise<void>
  settings: AppSettings | null
  setView: (view: 'onboarding' | 'dashboard' | 'settings') => void
}

export function useDashboard(): UseDashboardReturn {
  const {
    repositories,
    worktrees,
    statuses,
    scanProgress,
    selectedRepositoryId,
    settings,
    setStatuses,
    setStatus,
    removeStatuses,
    applyBranchChange,
    setSettings,
    setView,
    setRepositories,
    setWorktrees,
    setSelectedRepositoryId,
    setScanProgress,
  } = useAppStore()

  const [filter, setFilter] = useState<'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'>('all')
  const [search, setSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  // Worktrees whose project cleanup hook is running. Tearing down a Docker
  // stack takes a while, so the row has to say something is happening.
  const [cleaningIds, setCleaningIds] = useState<Set<string>>(new Set())
  const [baseStatuses, setBaseStatuses] = useState<Record<string, RepositoryBaseStatus>>({})

  // Everything below is keyed by repository id. A project's refresh, base
  // update, progress and errors are its own, so starting a slow update in one
  // project leaves every other project fully usable while it runs.
  const [loadingRepoIds, setLoadingRepoIds] = useState<Set<string>>(new Set())
  const [baseUpdatingRepoIds, setBaseUpdatingRepoIds] = useState<Set<string>>(new Set())
  const [statusProgressByRepo, setStatusProgressByRepo] = useState<Record<string, Progress>>({})
  const [baseProgressByRepo, setBaseProgressByRepo] = useState<Record<string, Progress>>({})
  const [errorsByRepo, setErrorsByRepo] = useState<Record<string, string>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)

  const refreshSeq = useRef(new Map<string, number>())
  // Per-repo request counter: a slow response from an earlier refresh must not
  // land on top of a newer one for the same project.
  const loadSeq = useRef(new Map<string, number>())
  // Guards re-entry without waiting for a state round-trip.
  const baseUpdatingRef = useRef(new Set<string>())

  const setRepoError = useCallback((repositoryId: string, message: string | null) => {
    setErrorsByRepo((prev) => {
      if (message === null) {
        if (!(repositoryId in prev)) return prev
        const { [repositoryId]: _cleared, ...rest } = prev
        return rest
      }
      return { ...prev, [repositoryId]: message }
    })
  }, [])

  const clearProgress = useCallback((repositoryId: string) => {
    const drop = (prev: Record<string, Progress>) => {
      if (!(repositoryId in prev)) return prev
      const { [repositoryId]: _done, ...rest } = prev
      return rest
    }
    setStatusProgressByRepo(drop)
    setBaseProgressByRepo(drop)
  }, [])

  const loadRepoStatuses = useCallback(
    async (repositoryId: string) => {
      const state = useAppStore.getState()
      const repository = state.repositories.find((r) => r.id === repositoryId)
      if (!repository) return
      const scoped = state.worktrees.filter((w) => w.repositoryId === repositoryId)
      if (scoped.length === 0) return

      const request = (loadSeq.current.get(repositoryId) ?? 0) + 1
      loadSeq.current.set(repositoryId, request)
      const isCurrent = () => loadSeq.current.get(repositoryId) === request

      setLoadingRepoIds((ids) => toggleId(ids, repositoryId, true))
      clearProgress(repositoryId)
      try {
        const result = await api.getWorktreeStatuses({
          worktrees: scoped,
          repositories: [repository],
          scopeId: repositoryId,
        })
        if (!isCurrent()) return
        setStatuses(
          result.statuses,
          scoped.map((w) => w.id)
        )
        const base = result.baseStatuses.find((s) => s.repositoryId === repositoryId)
        if (base) setBaseStatuses((prev) => ({ ...prev, [repositoryId]: base }))
      } catch (err) {
        if (isCurrent()) setRepoError(repositoryId, String(err))
      } finally {
        if (isCurrent()) {
          setLoadingRepoIds((ids) => toggleId(ids, repositoryId, false))
          clearProgress(repositoryId)
        }
      }
    },
    [clearProgress, setRepoError, setStatuses]
  )

  const refreshWorktreeStatus = useCallback(
    async (worktree: Worktree, isCancelled?: () => boolean) => {
      const repo = useAppStore.getState().repositories.find((r) => r.id === worktree.repositoryId)
      if (!repo) return

      const request = (refreshSeq.current.get(worktree.id) ?? 0) + 1
      refreshSeq.current.set(worktree.id, request)
      const isCurrent = () => refreshSeq.current.get(worktree.id) === request

      if (isCancelled?.()) return
      setRefreshingIds((ids) => {
        const next = new Set(ids)
        next.add(worktree.id)
        return next
      })
      try {
        const status = await api.getWorktreeStatus({ worktree, repository: repo })
        if (isCancelled?.()) return
        if (isCurrent()) setStatus(worktree.id, status)
      } finally {
        if (isCancelled?.()) return
        if (isCurrent()) {
          setRefreshingIds((ids) => {
            const next = new Set(ids)
            next.delete(worktree.id)
            return next
          })
        }
      }
    },
    [setRefreshingIds, setStatus]
  )

  const watchedWorktreeIds = useMemo(() => {
    const ids: string[] = []
    for (const w of worktrees) {
      if (w.repositoryId === selectedRepositoryId && !w.prunable) {
        ids.push(w.id)
      }
    }
    return ids.join(',')
  }, [worktrees, selectedRepositoryId])

  useEffect(() => {
    if (!selectedRepositoryId) return
    let cancelled = false

    const resync = (worktreeId: string, branch: string) => {
      if (cancelled) return
      const state = useAppStore.getState()
      const worktree = state.worktrees.find((w) => w.id === worktreeId)
      const known = state.statuses[worktreeId]
      if (!worktree || !known) return
      if (known.branch !== branch) applyBranchChange(worktreeId, branch)
      void refreshWorktreeStatus(worktree, () => cancelled)
    }

    const watched = useAppStore
      .getState()
      .worktrees.filter((w) => w.repositoryId === selectedRepositoryId && !w.prunable)
    void api.watchWorktreeHeads({ worktrees: watched }).catch(() => undefined)

    const removeHeadListener = api.onWorktreeHeadChanged(({ worktreeId, branch, headCommit }) => {
      if (cancelled) return
      const known = useAppStore.getState().statuses[worktreeId]
      if (!known || (known.branch === branch && known.headCommit === headCommit)) return
      resync(worktreeId, branch)
    })

    const syncBranches = async () => {
      if (document.hidden || cancelled) return
      const state = useAppStore.getState()
      const watched = state.worktrees.filter(
        (w) => w.repositoryId === selectedRepositoryId && !w.prunable
      )
      if (watched.length === 0) return

      const current = await api.getWorktreeBranches({ worktrees: watched }).catch(() => [])
      if (cancelled) return

      for (const { worktreeId, branch } of current) {
        if (useAppStore.getState().statuses[worktreeId]?.branch === branch) continue
        resync(worktreeId, branch)
      }
    }

    const interval = window.setInterval(syncBranches, 60_000)
    window.addEventListener('focus', syncBranches)
    document.addEventListener('visibilitychange', syncBranches)
    void syncBranches()
    return () => {
      cancelled = true
      removeHeadListener()
      window.clearInterval(interval)
      window.removeEventListener('focus', syncBranches)
      document.removeEventListener('visibilitychange', syncBranches)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepositoryId, watchedWorktreeIds, applyBranchChange, refreshWorktreeStatus])

  useEffect(() => {
    const remove = api.onScanProgress((progress) => setScanProgress(progress))
    return remove
  }, [setScanProgress])

  useEffect(() => {
    return api.onStatusProgress(({ scopeId, current, total }) => {
      if (!scopeId) return
      setStatusProgressByRepo((prev) => ({ ...prev, [scopeId]: { current, total } }))
    })
  }, [])

  useEffect(() => {
    return api.onBaseStatusProgress(({ scopeId, current, total }) => {
      if (!scopeId) return
      setBaseProgressByRepo((prev) => ({ ...prev, [scopeId]: { current, total } }))
    })
  }, [])

  // Worktrees we have already kicked off a status load for. Removing a worktree
  // (a delete in one project) leaves every id here untouched, so it no longer
  // drags every other project through a fresh round of git and network calls —
  // only genuinely new worktrees trigger a load, and only for their own project.
  const loadedWorktreeIds = useRef(new Set<string>())

  useEffect(() => {
    const stale = new Set<string>()
    for (const w of worktrees) {
      if (!loadedWorktreeIds.current.has(w.id)) stale.add(w.repositoryId)
    }
    if (stale.size === 0) return
    for (const w of worktrees) loadedWorktreeIds.current.add(w.id)
    for (const repositoryId of stale) void loadRepoStatuses(repositoryId)
  }, [worktrees, loadRepoStatuses])

  const rescan = useCallback(async () => {
    if (scanning) return
    const roots = new Set<string>()
    for (const dir of settings?.watchedDirectories ?? []) {
      if (dir.trim().length > 0) roots.add(dir)
    }
    for (const r of repositories) {
      if (r.path.trim().length > 0) roots.add(r.path)
    }
    if (roots.size === 0) return

    setScanning(true)
    setScanProgress({ total: roots.size, current: 0, found: 0 })
    setGlobalError(null)
    console.info('[worktree] rescan:start', { roots: roots.size })
    try {
      const result = await api.discoverWorktrees({ roots: Array.from(roots), maxDepth: 5 })
      if (result.cancelled) {
        console.info('[worktree] rescan:cancelled')
        return
      }

      const existingByPath = new Map(repositories.map((r) => [r.path, r]))
      const existingById = new Map(repositories.map((r) => [r.id, r]))
      const mergedRepos: Repository[] = []
      for (const r of result.repositories) {
        mergedRepos.push(
          mergeDiscoveredRepository(r, existingByPath.get(r.path) || existingById.get(r.id))
        )
      }

      const kept: Worktree[] = []
      for (const w of worktrees) {
        if (!result.repositories.some((r) => r.id === w.repositoryId)) {
          kept.push(w)
        }
      }
      const mergedWorktrees = [...kept, ...result.worktrees]

      await Promise.all([api.setRepositories(mergedRepos), api.setWorktrees(mergedWorktrees)])
      setRepositories(mergedRepos)
      // A rescan is the one deliberately global action: forget what we've loaded
      // so the effect below re-reads every project's status from disk.
      loadedWorktreeIds.current.clear()
      setWorktrees(mergedWorktrees)
      console.info('[worktree] rescan:done', {
        repositories: mergedRepos.length,
        worktrees: mergedWorktrees.length,
      })
    } catch (err) {
      console.error('[worktree] rescan:error', err)
      setGlobalError(String(err))
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }, [
    scanning,
    settings,
    repositories,
    worktrees,
    setRepositories,
    setWorktrees,
    setScanning,
    setScanProgress,
    setGlobalError,
  ])

  const persistRepos = useCallback(
    async (next: Repository[]) => {
      setRepositories(next)
      await api.setRepositories(next)
    },
    [setRepositories]
  )

  const selectRepository = useCallback(
    async (id: string) => {
      setSelectedRepositoryId(id)
      if (settings) {
        await api.setSettings({ ...settings, lastSelectedRepositoryId: id })
      }
    },
    [setSelectedRepositoryId, settings]
  )

  useEffect(() => {
    if (repositories.length === 0) return
    if (selectedRepositoryId && repositories.some((r) => r.id === selectedRepositoryId)) return

    const last = settings?.lastSelectedRepositoryId
    const validLast = last && repositories.some((r) => r.id === last)
    const sorted = [...repositories].sort((a, b) => a.name.localeCompare(b.name))
    const firstFavorite = sorted.find((r) => r.favorite)
    const fallback = validLast
      ? repositories.find((r) => r.id === last)!
      : (firstFavorite ?? repositories[0]!)
    setSelectedRepositoryId(fallback.id)
  }, [repositories, selectedRepositoryId, setSelectedRepositoryId, settings])

  const updateRepo = useCallback(
    async (id: string, patch: Partial<Repository>) => {
      const next = repositories.map((r) => (r.id === id ? { ...r, ...patch } : r))
      await persistRepos(next)
    },
    [repositories, persistRepos]
  )

  const sortedRepos = useMemo(() => {
    const query = projectSearch.toLowerCase()
    const filtered: Repository[] = []
    for (const r of repositories) {
      if (query) {
        const name = r.name.toLowerCase()
        const path = r.path.toLowerCase()
        if (!name.includes(query) && !path.includes(query)) continue
      }
      filtered.push(r)
    }
    return filtered.sort((a, b) => {
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [repositories, projectSearch])

  const selectedRepo = useMemo(
    () => repositories.find((r) => r.id === selectedRepositoryId) ?? null,
    [repositories, selectedRepositoryId]
  )

  // Scoped to one project end to end: the lock, the error and the follow-up
  // refresh all belong to `repositoryId`, so updating main in one project while
  // deleting a worktree in another is two independent operations.
  const updateRepoBase = useCallback(
    async (repositoryId: string) => {
      const repository = useAppStore.getState().repositories.find((r) => r.id === repositoryId)
      if (!repository) return
      if (baseUpdatingRef.current.has(repositoryId)) return

      baseUpdatingRef.current.add(repositoryId)
      setBaseUpdatingRepoIds((ids) => toggleId(ids, repositoryId, true))
      setRepoError(repositoryId, null)
      try {
        const result = await api.updateBaseBranch({
          path: repository.path,
          baseBranch: repository.baseBranch || 'main',
        })
        if (!result.success) setRepoError(repositoryId, result.output)
        await loadRepoStatuses(repositoryId)
      } catch (err) {
        setRepoError(repositoryId, String(err))
      } finally {
        baseUpdatingRef.current.delete(repositoryId)
        setBaseUpdatingRepoIds((ids) => toggleId(ids, repositoryId, false))
      }
    },
    [loadRepoStatuses, setRepoError]
  )

  const updateSelectedBase = useCallback(async () => {
    if (!selectedRepositoryId) return
    await updateRepoBase(selectedRepositoryId)
  }, [selectedRepositoryId, updateRepoBase])

  const loadStatuses = useCallback(async () => {
    if (!selectedRepositoryId) return
    await loadRepoStatuses(selectedRepositoryId)
  }, [selectedRepositoryId, loadRepoStatuses])

  const effectiveEditor = selectedRepo?.preferredEditor || settings?.defaultEditor || 'cursor'
  const sortMode = settings?.worktreeSort ?? 'activity'
  const sortDirection = settings?.worktreeSortDirection ?? defaultDirectionFor(sortMode)

  const updateWorktreeSort = useCallback(
    async (nextSort: WorktreeSort, nextDirection: WorktreeSortDirection) => {
      const current = useAppStore.getState().settings ?? settings
      if (!current) return
      const next = {
        ...current,
        worktreeSort: nextSort,
        worktreeSortDirection: nextDirection,
      }
      setSettings(next)
      try {
        await api.setSettings(next)
      } catch (err) {
        // Sort order is an app-wide setting, not a project's, so this failure
        // belongs to the global channel rather than whichever repo is selected.
        setGlobalError(`Could not save worktree ordering: ${String(err)}`)
      }
    },
    [settings, setSettings, setGlobalError]
  )

  const repoWorktrees = useMemo(() => {
    if (!selectedRepo) return []
    const query = search.toLowerCase()
    const filtered: Worktree[] = []
    for (const w of worktrees) {
      if (w.repositoryId !== selectedRepo.id) continue
      const status = statuses[w.id]
      if (query) {
        const text = `${status?.branch ?? w.branch} ${w.path}`.toLowerCase()
        if (!text.includes(query)) continue
      }
      if (filter === 'dirty') {
        if (!status?.dirty && !status?.staged) continue
      } else if (filter === 'unmerged') {
        const branch = status?.branch ?? w.branch
        if (
          !status ||
          status.mergedIntoBase ||
          branch === status.baseBranch ||
          branch === 'HEAD'
        ) {
          continue
        }
      } else if (filter === 'unpushed') {
        if ((status?.ahead ?? 0) === 0 && (status?.unpushed ?? 0) === 0) continue
      } else if (filter === 'safe') {
        if (!isSafeToDelete(w, status)) continue
      }
      filtered.push(w)
    }
    return sortWorktrees(filtered, statuses, sortMode, sortDirection)
  }, [selectedRepo, worktrees, statuses, filter, search, sortMode, sortDirection])

  const worktreeSections = useMemo(
    () => groupWorktrees(repoWorktrees, statuses, sortMode === 'safety'),
    [repoWorktrees, statuses, sortMode]
  )

  const worktreeCountByRepo = useMemo(() => {
    const map = new Map<string, number>()
    for (const w of worktrees) {
      map.set(w.repositoryId, (map.get(w.repositoryId) ?? 0) + 1)
    }
    return map
  }, [worktrees])

  const handleDelete = useCallback(
    async (w: Worktree) => {
      if (w.isMain) {
        window.alert('The primary worktree cannot be deleted from here.')
        return
      }
      const repo = repositories.find((r) => r.id === w.repositoryId)
      if (!repo) return

      // The project's cleanup hook, run while the worktree is still on disk so
      // it can read per-worktree config (a Docker .env, a lockfile) to find out
      // what to tear down. A failure is reported, never silently swallowed —
      // but it doesn't get to block the delete on its own, since a stopped
      // Docker daemon shouldn't strand a worktree the user wants gone.
      const runCleanup = async (branch: string): Promise<boolean> => {
        const command = repo.preDeleteCommand?.trim()
        if (!command) return true

        setCleaningIds((ids) => toggleId(ids, w.id, true))
        try {
          const result = await window.api.runWorktreeCleanup({
            command,
            worktreePath: w.path,
            repoPath: repo.path,
            branch,
            repoName: repo.name,
            ...(repo.preDeleteTimeoutSeconds
              ? { timeoutSeconds: repo.preDeleteTimeoutSeconds }
              : {}),
          })
          if (result.success) {
            if (result.output) console.info('[worktree] cleanup:done', w.path, result.output)
            return true
          }
          const reason = result.timedOut
            ? `The cleanup command timed out.`
            : `The cleanup command failed${result.exitCode != null ? ` (exit ${result.exitCode})` : ''}.`
          setRepoError(repo.id, `${reason}\n\n${result.output}`)
          return window.confirm(
            `${reason}\n\n${result.output}\n\nDelete the worktree anyway? Whatever it allocated may stay behind.`
          )
        } finally {
          setCleaningIds((ids) => toggleId(ids, w.id, false))
        }
      }

      if (w.prunable) {
        const ok = window.confirm(
          `This worktree's folder is already gone.\n\nRemove the stale entry from git?\n${shortenPath(w.path)}`
        )
        if (!ok) return
        // The folder is gone but whatever it allocated may not be, so the hook
        // still runs — from the repo root, since there's no worktree dir left.
        if (!(await runCleanup(w.branch))) return
        const res = await window.api.removeWorktree({
          path: w.path,
          repoPath: repo.path,
          missing: true,
        })
        if (!res.success) {
          setRepoError(repo.id, res.error || 'Failed to prune worktree')
          return
        }
        const pruned = worktrees.filter((x) => x.repositoryId === repo.id && x.prunable)
        const next = worktrees.filter((x) => !(x.repositoryId === repo.id && x.prunable))
        removeStatuses(pruned.map((x) => x.id))
        setWorktrees(next)
        await api.setWorktrees(next)
        return
      }

      const status = statuses[w.id]
      if (status) {
        const safety = await api.evaluateSafety({ worktree: w, status })
        if (!safety.safe) {
          const ok = window.confirm(
            `This worktree may not be safe to delete:\n${safety.reasons.join('\n')}\n\nMove it to Trash anyway? (Recoverable from Trash)`
          )
          if (!ok) return
        } else {
          const ok = window.confirm(
            `Move worktree to Trash?\n${shortenPath(w.path)}\n\nThis uses the system Trash and can be restored.`
          )
          if (!ok) return
        }
      } else {
        const ok = window.confirm(
          `Move worktree to Trash?\n${shortenPath(w.path)}\n\nThis uses the system Trash and can be restored.`
        )
        if (!ok) return
      }

      const branch = status?.branch ?? w.branch
      if (!(await runCleanup(branch))) return

      const shouldDeleteBranch =
        status?.mergedIntoBase === true && branch !== 'HEAD' && branch !== status.baseBranch
      const res = await window.api.removeWorktree({
        path: w.path,
        repoPath: repo.path,
        branch,
        deleteBranch: shouldDeleteBranch,
      })
      if (!res.success) {
        setRepoError(repo.id, res.error || 'Failed to remove worktree')
        return
      }
      if (res.branchError) setRepoError(repo.id, res.branchError)
      // Drop just this worktree's row and status. Nothing else in this project
      // changed and nothing at all changed in the others, so no refresh fires.
      const next = worktrees.filter((x) => x.path !== w.path)
      removeStatuses([w.id])
      setWorktrees(next)
      await api.setWorktrees(next)
    },
    [repositories, removeStatuses, setCleaningIds, setRepoError, setWorktrees, statuses, worktrees]
  )

  const saveRepository = useCallback(
    async (repo: Repository) => {
      const next = repositories.map((r) => (r.id === repo.id ? repo : r))
      await persistRepos(next)
      setConfigRepoId(null)
      // Only the edited project's settings changed (base branch, token, …).
      await loadRepoStatuses(repo.id)
    },
    [repositories, persistRepos, setConfigRepoId, loadRepoStatuses]
  )

  // Everything the chrome renders is the selected project's slice of the
  // per-repo maps — switching projects switches which spinner you're watching,
  // it never merges two projects' progress into one indicator.
  const loading = selectedRepositoryId ? loadingRepoIds.has(selectedRepositoryId) : false
  const baseUpdating = selectedRepositoryId ? baseUpdatingRepoIds.has(selectedRepositoryId) : false
  const statusProgress = selectedRepositoryId
    ? (statusProgressByRepo[selectedRepositoryId] ?? null)
    : null
  const baseStatusProgress = selectedRepositoryId
    ? (baseProgressByRepo[selectedRepositoryId] ?? null)
    : null
  const actionError =
    globalError ?? (selectedRepositoryId ? (errorsByRepo[selectedRepositoryId] ?? null) : null)

  const busyRepoIds = useMemo(
    () => new Set([...loadingRepoIds, ...baseUpdatingRepoIds]),
    [loadingRepoIds, baseUpdatingRepoIds]
  )
  const erroredRepoIds = useMemo(() => new Set(Object.keys(errorsByRepo)), [errorsByRepo])

  // Dismissing the banner clears whichever error it was showing.
  const setActionError = useCallback(
    (value: string | null) => {
      if (value === null) {
        setGlobalError(null)
        if (selectedRepositoryId) setRepoError(selectedRepositoryId, null)
        return
      }
      if (selectedRepositoryId) setRepoError(selectedRepositoryId, value)
      else setGlobalError(value)
    },
    [selectedRepositoryId, setRepoError]
  )

  const onActionError = useCallback(
    (message: string) => {
      setActionError(message)
    },
    [setActionError]
  )

  return {
    repositories,
    worktrees,
    statuses,
    scanProgress,
    statusProgress,
    baseStatusProgress,
    loading,
    scanning,
    refreshingIds,
    cleaningIds,
    baseStatuses,
    baseUpdating,
    busyRepoIds,
    erroredRepoIds,
    selectedRepositoryId,
    projectSearch,
    setProjectSearch,
    sortedRepos,
    selectedRepo,
    worktreeSections,
    repoWorktrees,
    worktreeCountByRepo,
    effectiveEditor,
    sortMode,
    sortDirection,
    filter,
    setFilter,
    search,
    setSearch,
    configRepoId,
    setConfigRepoId,
    actionError,
    setActionError,
    setRepoError,
    rescan,
    loadRepoStatuses,
    loadStatuses,
    updateRepoBase,
    updateSelectedBase,
    selectRepository,
    updateRepo,
    updateWorktreeSort,
    handleDelete,
    refreshWorktreeStatus,
    saveRepository,
    onActionError,
    onBranchChange: applyBranchChange,
    settings,
    setView,
  }
}
