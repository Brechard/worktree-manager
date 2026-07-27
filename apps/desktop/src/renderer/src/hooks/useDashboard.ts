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

export function defaultDirectionFor(sort: WorktreeSort): WorktreeSortDirection {
  return sort === 'name' ? 'asc' : sort === 'activity' ? 'desc' : 'asc'
}

export interface UseDashboardReturn {
  repositories: Repository[]
  worktrees: Worktree[]
  statuses: Record<string, WorktreeStatus>
  scanProgress: ScanProgress | null
  statusProgress: { current: number; total: number } | null
  loading: boolean
  scanning: boolean
  refreshingIds: Set<string>
  baseStatuses: Record<string, RepositoryBaseStatus>
  baseUpdating: boolean
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
  actionError: string | null
  setActionError: (value: string | null) => void
  rescan: () => Promise<void>
  loadStatuses: () => Promise<void>
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
    applyBranchChange,
    setSettings,
    setView,
    setRepositories,
    setWorktrees,
    setSelectedRepositoryId,
    setScanProgress,
  } = useAppStore()

  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'>('all')
  const [search, setSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [statusProgress, setStatusProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set())
  const [baseStatuses, setBaseStatuses] = useState<Record<string, RepositoryBaseStatus>>({})
  const [baseUpdating, setBaseUpdating] = useState(false)

  const refreshSeq = useRef(new Map<string, number>())

  const loadStatuses = useCallback(async () => {
    if (worktrees.length === 0) return
    setLoading(true)
    try {
      const result = await api.getWorktreeStatuses({ worktrees, repositories })
      setStatuses(result.statuses)
      const nextBase: Record<string, RepositoryBaseStatus> = {}
      for (const status of result.baseStatuses) {
        nextBase[status.repositoryId] = status
      }
      setBaseStatuses(nextBase)
    } finally {
      setLoading(false)
      setStatusProgress(null)
    }
  }, [repositories, setLoading, setStatuses, setBaseStatuses, setStatusProgress, worktrees])

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
    const remove = api.onStatusProgress((progress) => setStatusProgress(progress))
    return remove
  }, [])

  useEffect(() => {
    if (worktrees.length === 0) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const result = await api.getWorktreeStatuses({ worktrees, repositories })
        if (cancelled) return
        setStatuses(result.statuses)
        const nextBase: Record<string, RepositoryBaseStatus> = {}
        for (const status of result.baseStatuses) {
          nextBase[status.repositoryId] = status
        }
        setBaseStatuses(nextBase)
      } finally {
        setLoading(false)
        setStatusProgress(null)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [repositories, setBaseStatuses, setLoading, setStatuses, setStatusProgress, worktrees])

  const rescan = useCallback(async () => {
    if (scanning || loading) return
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
    setActionError(null)
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
        const prev = existingByPath.get(r.path) || existingById.get(r.id)
        if (!prev) {
          mergedRepos.push(r)
          continue
        }
        mergedRepos.push({
          ...r,
          favorite: prev.favorite ?? r.favorite,
          preferredEditor: prev.preferredEditor ?? r.preferredEditor,
          imageUrl: prev.imageUrl ?? r.imageUrl,
          baseBranch: r.baseBranch || prev.baseBranch,
          provider: prev.provider?.personalAccessToken ? prev.provider : (r.provider ?? prev.provider),
        })
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
      setWorktrees(mergedWorktrees)
      console.info('[worktree] rescan:done', {
        repositories: mergedRepos.length,
        worktrees: mergedWorktrees.length,
      })
    } catch (err) {
      console.error('[worktree] rescan:error', err)
      setActionError(String(err))
    } finally {
      setScanning(false)
      setScanProgress(null)
      setLoading(false)
    }
    await loadStatuses()
  }, [
    loading,
    scanning,
    settings,
    repositories,
    worktrees,
    setRepositories,
    setWorktrees,
    setScanning,
    setScanProgress,
    setActionError,
    setLoading,
    loadStatuses,
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

  const updateSelectedBase = useCallback(async () => {
    if (!selectedRepo || baseUpdating) return
    setBaseUpdating(true)
    setActionError(null)
    try {
      const result = await api.updateBaseBranch({
        path: selectedRepo.path,
        baseBranch: selectedRepo.baseBranch || 'main',
      })
      if (!result.success) setActionError(result.output)
      await loadStatuses()
    } catch (err) {
      setActionError(String(err))
    } finally {
      setBaseUpdating(false)
    }
  }, [selectedRepo, baseUpdating, loadStatuses, setActionError, setBaseUpdating])

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
        setActionError(`Could not save worktree ordering: ${String(err)}`)
      }
    },
    [settings, setSettings, setActionError]
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

      if (w.prunable) {
        const ok = window.confirm(
          `This worktree's folder is already gone.\n\nRemove the stale entry from git?\n${shortenPath(w.path)}`
        )
        if (!ok) return
        const res = await window.api.removeWorktree({
          path: w.path,
          repoPath: repo.path,
          missing: true,
        })
        if (!res.success) {
          setActionError(res.error || 'Failed to prune worktree')
          return
        }
        const next = worktrees.filter((x) => !(x.repositoryId === repo.id && x.prunable))
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

      const res = await window.api.removeWorktree({ path: w.path, repoPath: repo.path })
      if (!res.success) {
        setActionError(res.error || 'Failed to remove worktree')
        return
      }
      const next = worktrees.filter((x) => x.path !== w.path)
      setWorktrees(next)
      await api.setWorktrees(next)
    },
    [repositories, setActionError, setWorktrees, statuses, worktrees]
  )

  const onActionError = useCallback((message: string) => {
    setActionError(message)
  }, [setActionError])

  const saveRepository = useCallback(
    async (repo: Repository) => {
      const next = repositories.map((r) => (r.id === repo.id ? repo : r))
      await persistRepos(next)
      setConfigRepoId(null)
      await loadStatuses()
    },
    [repositories, persistRepos, setConfigRepoId, loadStatuses]
  )

  return {
    repositories,
    worktrees,
    statuses,
    scanProgress,
    statusProgress,
    loading,
    scanning,
    refreshingIds,
    baseStatuses,
    baseUpdating,
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
    rescan,
    loadStatuses,
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
