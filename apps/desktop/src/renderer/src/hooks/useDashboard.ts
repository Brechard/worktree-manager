import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  CleanupCandidate,
  Repository,
  RepositoryBaseStatus,
  ScanProgress,
  Worktree,
  WorktreeDiskUsage,
  WorktreeSort,
  WorktreeSortDirection,
  WorktreeStatus,
} from '@worktree/contracts'
import {
  cleanupCandidacy,
  formatBytes,
  recommendedSyncMode,
  updateOffers,
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

/**
 * Every worktree of a project whose branch has already landed in the base,
 * split into the ones that are plainly done and the ones carrying something
 * that deserves a look first. Ready ones come first, then biggest first —
 * within a group the size is the only reason to pick one over another.
 */
function collectCleanupCandidates(repositoryId: string): CleanupCandidate[] {
  const state = useAppStore.getState()
  const candidates: CleanupCandidate[] = []
  for (const worktree of state.worktrees) {
    if (worktree.repositoryId !== repositoryId) continue
    const candidacy = cleanupCandidacy(worktree, state.statuses[worktree.id])
    if (candidacy) candidates.push({ worktree, ...candidacy })
  }
  return candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'ready' ? -1 : 1
    return (
      (state.diskUsage[b.worktree.id]?.totalBytes ?? 0) -
      (state.diskUsage[a.worktree.id]?.totalBytes ?? 0)
    )
  })
}

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
  /** Disk usage per worktree id, filled in as measurements come back. */
  diskUsage: Record<string, WorktreeDiskUsage>
  /** Worktrees currently being measured or having space reclaimed. */
  measuringIds: Set<string>
  /** Measure every worktree of a project (`refresh` re-walks measured ones). */
  measureRepoDisk: (repositoryId: string, options?: { refresh?: boolean }) => Promise<void>
  /** Delete one worktree's regenerable directories after confirming. */
  reclaimSpace: (worktree: Worktree) => Promise<void>
  /** The selected project's landed-branch worktrees and what they cost. */
  cleanupSummary: {
    ready: number
    review: number
    bytes: number
    /** True while some of those worktrees have not been measured yet. */
    measuring: boolean
  }
  /** Worktrees whose branch has landed, offered for removal. */
  cleanupCandidates: { repositoryId: string; candidates: CleanupCandidate[] } | null
  openCleanupCandidates: (repositoryId: string) => void
  dismissCleanupCandidates: () => void
  deleteCleanupCandidates: (selected: Worktree[], permanent: boolean) => Promise<void>
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
  /** Base branch back under the primary worktree, pulled, then every other
   *  worktree replayed onto it. */
  catchUpProject: (repositoryId: string) => Promise<void>
  /** True while the *selected* project's catch-up sweep is running. */
  catchingUp: boolean
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
    diskUsage,
    scanProgress,
    selectedRepositoryId,
    settings,
    setStatuses,
    setStatus,
    removeStatuses,
    setDiskUsage,
    removeDiskUsage,
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
  /**
   * Worktrees whose branch has already landed in the base, offered for bulk
   * removal — either after a catch-up sweep or from the project header. Never
   * deleted outright: the ones that need a look are exactly the ones where a
   * silent delete would be a bad surprise.
   */
  const [cleanupCandidates, setCleanupCandidates] = useState<{
    repositoryId: string
    candidates: CleanupCandidate[]
  } | null>(null)
  // Worktrees with a `du` walk or a reclaim in flight.
  const [measuringIds, setMeasuringIds] = useState<Set<string>>(new Set())
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
  const [catchingUpRepoIds, setCatchingUpRepoIds] = useState<Set<string>>(new Set())
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
  const catchingUpRef = useRef(new Set<string>())

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

  // Measuring a worktree walks its whole tree, so it runs a few at a time in
  // the background: sizes fill in row by row while everything stays usable. The
  // main process caches by path, so re-opening a project costs nothing.
  const measuringReposRef = useRef(new Set<string>())
  const measurementSeq = useRef(new Map<string, number>())

  const measureOne = useCallback(
    async (worktree: Worktree, refresh: boolean) => {
      const request = (measurementSeq.current.get(worktree.id) ?? 0) + 1
      measurementSeq.current.set(worktree.id, request)
      const isCurrent = () => measurementSeq.current.get(worktree.id) === request
      setMeasuringIds((ids) => toggleId(ids, worktree.id, true))
      try {
        const usage = await api.measureWorktreeDisk({
          worktreeId: worktree.id,
          path: worktree.path,
          ...(refresh ? { refresh: true } : {}),
        })
        // The worktree may have been deleted while `du` was walking it.
        if (
          isCurrent() &&
          useAppStore.getState().worktrees.some((w) => w.id === worktree.id)
        ) {
          setDiskUsage(usage)
        }
      } catch {
        // A size we could not measure is a missing badge, not an error banner.
      } finally {
        if (isCurrent()) setMeasuringIds((ids) => toggleId(ids, worktree.id, false))
      }
    },
    [setDiskUsage]
  )

  const measureRepoDisk = useCallback(
    async (repositoryId: string, options?: { refresh?: boolean }) => {
      const refresh = options?.refresh === true
      if (measuringReposRef.current.has(repositoryId)) return
      const state = useAppStore.getState()
      const targets = state.worktrees.filter(
        (w) =>
          w.repositoryId === repositoryId && !w.prunable && (refresh || !state.diskUsage[w.id])
      )
      if (targets.length === 0) return

      measuringReposRef.current.add(repositoryId)
      try {
        let cursor = 0
        const workers = Array.from({ length: Math.min(3, targets.length) }, async () => {
          while (cursor < targets.length) {
            const next = targets[cursor++]
            if (!next) return
            await measureOne(next, refresh)
          }
        })
        await Promise.all(workers)
      } finally {
        measuringReposRef.current.delete(repositoryId)
      }
    },
    [measureOne]
  )

  // Sizes are the whole point of the feature, so they load on their own rather
  // than behind a button the user has to know to press.
  useEffect(() => {
    if (!selectedRepositoryId) return
    void measureRepoDisk(selectedRepositoryId)
  }, [selectedRepositoryId, worktrees, measureRepoDisk])

  const reclaimSpace = useCallback(
    async (worktree: Worktree) => {
      const usage = useAppStore.getState().diskUsage[worktree.id]
      if (!usage || usage.entries.length === 0) return

      const lines = usage.entries
        .slice(0, 12)
        .map((entry) => `  ${entry.path} — ${formatBytes(entry.bytes)}`)
      if (usage.entries.length > 12) lines.push(`  …and ${usage.entries.length - 12} more`)
      const ok = window.confirm(
        `Delete ${formatBytes(usage.reclaimableBytes)} of generated files from ${shortenPath(worktree.path)}?\n\n${lines.join('\n')}\n\n` +
          `These are ignored by git and come back with an install or a build. This deletes them outright — the Trash would not free the space.\n\n` +
          `Stop anything running from this worktree (a dev server, a watcher) first.`
      )
      if (!ok) return

      setMeasuringIds((ids) => toggleId(ids, worktree.id, true))
      try {
        const result = await api.reclaimWorktreeSpace({
          path: worktree.path,
          entries: usage.entries.map((entry) => entry.path),
        })
        if (result.errors.length > 0) {
          setRepoError(
            worktree.repositoryId,
            `Removed approximately ${formatBytes(result.freedBytes)} of allocated files, but some paths were kept:\n\n${result.errors.join('\n')}`
          )
        }
      } catch (err) {
        setRepoError(worktree.repositoryId, String(err))
      } finally {
        setMeasuringIds((ids) => toggleId(ids, worktree.id, false))
      }
      await measureOne(worktree, true)
    },
    [measureOne, setRepoError]
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

  /**
   * The whole-project reset offered once the base has moved on: put the primary
   * worktree back on the base branch, pull it, then replay every other worktree
   * onto it. Sequential on purpose — each step reads the state the previous one
   * left, and a project's worth of concurrent rebases is not something anyone
   * wants to untangle.
   *
   * Failures never abort the sweep past the first step: one branch that
   * conflicts is reported and skipped, so the rest still land.
   */
  const catchUpProject = useCallback(
    async (repositoryId: string) => {
      const state = useAppStore.getState()
      const repository = state.repositories.find((r) => r.id === repositoryId)
      if (!repository) return
      if (catchingUpRef.current.has(repositoryId)) return

      const baseBranch = repository.baseBranch || 'main'
      const scoped = state.worktrees.filter((w) => w.repositoryId === repositoryId && !w.prunable)
      const primary = scoped.find((w) => w.isMain)
      const others = scoped.filter((w) => !w.isMain)
      const notes: string[] = []

      catchingUpRef.current.add(repositoryId)
      setCatchingUpRepoIds((ids) => toggleId(ids, repositoryId, true))
      setRepoError(repositoryId, null)
      try {
        // 1. Back onto the base branch. If this fails the primary worktree is
        //    holding work the user has to deal with first, so nothing else runs
        //    — the base it would be pulling into is the wrong one.
        if (primary) {
          const branch = state.statuses[primary.id]?.branch ?? primary.branch
          if (branch !== baseBranch) {
            const checkout = await api.checkoutBranch({ path: primary.path, branch: baseBranch })
            if (!checkout.success) {
              setRepoError(
                repositoryId,
                `Could not switch the primary worktree to ${baseBranch}, so nothing else ran.\n\n${checkout.output}`
              )
              return
            }
            applyBranchChange(primary.id, baseBranch)
          }
        }

        // 2. Fast-forward the base itself.
        const update = await api.updateBaseBranch({
          path: primary?.path ?? repository.path,
          baseBranch,
        })
        if (!update.success) notes.push(`Could not update ${baseBranch}: ${update.output}`)

        // 3. Bring every other worktree up to the base it just caught up to.
        for (const worktree of others) {
          const status = useAppStore.getState().statuses[worktree.id]
          const branch = status?.branch ?? worktree.branch
          if (branch === 'HEAD' || status?.detached === true) {
            notes.push(`${shortenPath(worktree.path)}: skipped, detached HEAD.`)
            continue
          }
          if (branch === baseBranch) continue
          // Already merged into the base has nothing to gain from a rebase —
          // its commits are already upstream, so replaying them only turns a
          // clean, deletable worktree into one with unpushed duplicate
          // commits. Leave it alone; it is a cleanup candidate, not a sync.
          if (status?.mergedIntoBase === true) continue

          const offer = updateOffers(status).find((o) => o.target === 'base')
          const mode = offer?.mode ?? recommendedSyncMode(status, baseBranch).mode
          let result = await api.syncWithBase({
            path: worktree.path,
            baseBranch,
            target: 'base',
            mode,
          })
          // A rebase that conflicts often merges cleanly, and a fast-forward
          // that the branch has moved past has a mode that works too — the sync
          // says which. Take it: the point of the sweep is to leave nothing
          // half-done.
          if (result.recommendedMode && result.recommendedMode !== result.mode) {
            result = await api.syncWithBase({
              path: worktree.path,
              baseBranch,
              target: 'base',
              mode: result.recommendedMode,
            })
          }
          if (!result.success || result.outcome === 'restore-conflict') {
            notes.push(`${branch}: ${result.output}`)
          }
        }
      } catch (err) {
        notes.push(String(err))
      } finally {
        catchingUpRef.current.delete(repositoryId)
        setCatchingUpRepoIds((ids) => toggleId(ids, repositoryId, false))
        if (notes.length > 0) setRepoError(repositoryId, notes.join('\n\n'))
        await loadRepoStatuses(repositoryId)

        // Now that everything just got synced onto the fresh base, some of
        // these worktrees' branches may have been merged PRs all along —
        // surface them as a one-click bulk cleanup instead of leaving the
        // user to notice and remove each one by hand.
        const candidates = collectCleanupCandidates(repositoryId)
        if (candidates.length > 0) setCleanupCandidates({ repositoryId, candidates })
        // Sizes are what turn "8 merged worktrees" into a reason to act.
        void measureRepoDisk(repositoryId)
      }
    },
    [applyBranchChange, loadRepoStatuses, measureRepoDisk, setRepoError]
  )

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
        if (!status?.dirty && !status?.staged && !status?.hasUntracked) continue
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

  // What the selected project would get back by removing the worktrees whose
  // branch has already landed. Counted off the project's whole list, not the
  // filtered view — the search box has nothing to do with it.
  const cleanupSummary = useMemo(() => {
    let ready = 0
    let review = 0
    let bytes = 0
    let measuring = false
    for (const w of worktrees) {
      if (w.repositoryId !== selectedRepositoryId) continue
      const candidacy = cleanupCandidacy(w, statuses[w.id])
      if (!candidacy) continue
      if (candidacy.kind === 'ready') ready += 1
      else review += 1
      const usage = diskUsage[w.id]
      if (usage) bytes += usage.totalBytes
      else measuring = true
    }
    return { ready, review, bytes, measuring }
  }, [selectedRepositoryId, worktrees, statuses, diskUsage])

  const worktreeCountByRepo = useMemo(() => {
    const map = new Map<string, number>()
    for (const w of worktrees) {
      map.set(w.repositoryId, (map.get(w.repositoryId) ?? 0) + 1)
    }
    return map
  }, [worktrees])

  // The project's cleanup hook, run while the worktree is still on disk so it
  // can read per-worktree config (a Docker .env, a lockfile) to find out what
  // to tear down. A failure is reported, never silently swallowed — but it
  // doesn't get to block the delete on its own, since a stopped Docker daemon
  // shouldn't strand a worktree the user wants gone.
  const runCleanup = useCallback(
    async (w: Worktree, repo: Repository, branch: string): Promise<boolean> => {
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
          ...(repo.preDeleteTimeoutSeconds ? { timeoutSeconds: repo.preDeleteTimeoutSeconds } : {}),
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
    },
    [setCleaningIds, setRepoError]
  )

  // Runs cleanup, trashes the worktree, deletes its branch when it is merged,
  // and drops its row/status from the store. Shared by the single-row delete
  // (after its confirm dialogs) and the bulk cleanup-candidates modal (which
  // is its own confirmation, so it skips straight here for each worktree).
  const removeWorktreeAndBranch = useCallback(
    async (
      w: Worktree,
      repo: Repository,
      status: WorktreeStatus | undefined,
      options?: { permanent?: boolean }
    ): Promise<{ deleted: boolean; error?: string }> => {
      const branch = status?.branch ?? w.branch
      if (options?.permanent && !status) {
        return { deleted: false, error: 'Could not verify this worktree before permanent removal.' }
      }
      if (!(await runCleanup(w, repo, branch))) return { deleted: false }

      // A review candidate may contain local work. Its directory is recoverable
      // from Trash, so its branch must remain recoverable too. Only the clean,
      // plain "ready" case deletes the branch automatically; permanent removal
      // gets the same decision revalidated in main immediately before rm.
      const shouldDeleteBranch =
        cleanupCandidacy(w, status)?.kind === 'ready' &&
        branch !== 'HEAD' &&
        branch !== status?.baseBranch
      const res = await window.api.removeWorktree({
        path: w.path,
        repoPath: repo.path,
        branch,
        deleteBranch: shouldDeleteBranch,
        ...(status && (options?.permanent || shouldDeleteBranch)
          ? {
              ...(options?.permanent ? { permanent: true } : {}),
              worktree: w,
              repository: repo,
              expectedStatus: status,
            }
          : {}),
      })
      if (!res.success) {
        return { deleted: false, error: res.error || 'Failed to remove worktree' }
      }
      const next = useAppStore.getState().worktrees.filter((x) => x.path !== w.path)
      removeStatuses([w.id])
      removeDiskUsage([w.id])
      setWorktrees(next)
      await api.setWorktrees(next)
      return res.branchError ? { deleted: true, error: res.branchError } : { deleted: true }
    },
    [removeDiskUsage, removeStatuses, runCleanup, setWorktrees]
  )

  const handleDelete = useCallback(
    async (w: Worktree) => {
      if (w.isMain) {
        window.alert('The primary worktree cannot be deleted from here.')
        return
      }
      const repo = repositories.find((r) => r.id === w.repositoryId)
      if (!repo) return

      if (w.prunable) {
        const ok = window.confirm(
          `This worktree's folder is already gone.\n\nRemove the stale entry from git?\n${shortenPath(w.path)}`
        )
        if (!ok) return
        // The folder is gone but whatever it allocated may not be, so the hook
        // still runs — from the repo root, since there's no worktree dir left.
        if (!(await runCleanup(w, repo, w.branch))) return
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
        removeDiskUsage(pruned.map((x) => x.id))
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

      const outcome = await removeWorktreeAndBranch(w, repo, status)
      if (outcome.error) setRepoError(repo.id, outcome.error)
    },
    [
      repositories,
      removeDiskUsage,
      removeStatuses,
      removeWorktreeAndBranch,
      runCleanup,
      setRepoError,
      setWorktrees,
      statuses,
      worktrees,
    ]
  )

  const openCleanupCandidates = useCallback(
    (repositoryId: string) => {
      const candidates = collectCleanupCandidates(repositoryId)
      if (candidates.length === 0) return
      setCleanupCandidates({ repositoryId, candidates })
      void measureRepoDisk(repositoryId)
    },
    [measureRepoDisk]
  )

  const dismissCleanupCandidates = useCallback(() => setCleanupCandidates(null), [])

  const deleteCleanupCandidates = useCallback(
    async (selected: Worktree[], permanent: boolean) => {
      const repositoryId = cleanupCandidates?.repositoryId
      setCleanupCandidates(null)
      if (selected.length === 0) return
      const errors: string[] = []
      for (const w of selected) {
        const repo = useAppStore.getState().repositories.find((r) => r.id === w.repositoryId)
        if (!repo) continue
        const status = useAppStore.getState().statuses[w.id]
        const outcome = await removeWorktreeAndBranch(w, repo, status, { permanent })
        if (outcome.error) errors.push(`${shortenPath(w.path)}: ${outcome.error}`)
      }
      if (errors.length > 0 && repositoryId) setRepoError(repositoryId, errors.join('\n\n'))
    },
    [cleanupCandidates, removeWorktreeAndBranch, setRepoError]
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
  const catchingUp = selectedRepositoryId ? catchingUpRepoIds.has(selectedRepositoryId) : false
  const statusProgress = selectedRepositoryId
    ? (statusProgressByRepo[selectedRepositoryId] ?? null)
    : null
  const baseStatusProgress = selectedRepositoryId
    ? (baseProgressByRepo[selectedRepositoryId] ?? null)
    : null
  const actionError =
    globalError ?? (selectedRepositoryId ? (errorsByRepo[selectedRepositoryId] ?? null) : null)

  const busyRepoIds = useMemo(
    () => new Set([...loadingRepoIds, ...baseUpdatingRepoIds, ...catchingUpRepoIds]),
    [loadingRepoIds, baseUpdatingRepoIds, catchingUpRepoIds]
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
    diskUsage,
    measuringIds,
    measureRepoDisk,
    reclaimSpace,
    cleanupSummary,
    cleanupCandidates,
    openCleanupCandidates,
    dismissCleanupCandidates,
    deleteCleanupCandidates,
    actionError,
    setActionError,
    setRepoError,
    rescan,
    loadRepoStatuses,
    loadStatuses,
    updateRepoBase,
    updateSelectedBase,
    catchUpProject,
    catchingUp,
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
