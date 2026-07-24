import { useEffect, useMemo, useState } from 'react'
import {
  RefreshCw,
  Settings as SettingsIcon,
  Plus,
  Search,
  FolderGit2,
  SlidersHorizontal,
  Star,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import type { Repository } from '@worktree/contracts'
import { useAppStore } from '../store'
import { api } from '../api'
import { WorktreeRow } from './WorktreeRow'
import { ProjectConfigModal } from './ProjectConfigModal'
import { TitleBar } from './TitleBar'
import { cn } from '../lib/utils'
import { EDITOR_OPTIONS, editorLabel, shortenPath } from '../lib/paths'

export function Dashboard() {
  const {
    repositories,
    worktrees,
    statuses,
    selectedRepositoryId,
    settings,
    setStatuses,
    setView,
    setRepositories,
    setWorktrees,
    setSelectedRepositoryId,
  } = useAppStore()
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'>('all')
  const [search, setSearch] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [configRepoId, setConfigRepoId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadStatuses = async () => {
    if (worktrees.length === 0) return
    setLoading(true)
    try {
      const newStatuses = await api.getWorktreeStatuses({ worktrees, repositories })
      setStatuses(newStatuses)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatuses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktrees.length, repositories.length])

  useEffect(() => {
    if (repositories.length === 0) return
    if (!selectedRepositoryId || !repositories.some((r) => r.id === selectedRepositoryId)) {
      setSelectedRepositoryId(repositories[0]!.id)
    }
  }, [repositories, selectedRepositoryId, setSelectedRepositoryId])

  const persistRepos = async (next: Repository[]) => {
    setRepositories(next)
    await api.setRepositories(next)
  }

  const updateRepo = async (id: string, patch: Partial<Repository>) => {
    const next = repositories.map((r) => (r.id === id ? { ...r, ...patch } : r))
    await persistRepos(next)
  }

  const sortedRepos = useMemo(() => {
    return [...repositories]
      .filter((r) => {
        if (!projectSearch) return true
        const q = projectSearch.toLowerCase()
        return r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [repositories, projectSearch])

  const selectedRepo = repositories.find((r) => r.id === selectedRepositoryId) ?? null

  const effectiveEditor =
    selectedRepo?.preferredEditor || settings?.defaultEditor || 'cursor'

  const repoWorktrees = useMemo(() => {
    if (!selectedRepo) return []
    return worktrees
      .filter((w) => w.repositoryId === selectedRepo.id)
      .filter((w) => {
        const status = statuses[w.id]
        const text = `${w.branch} ${w.path}`.toLowerCase()
        if (search && !text.includes(search.toLowerCase())) return false
        if (filter === 'dirty') return Boolean(status?.dirty || status?.staged)
        if (filter === 'unmerged')
          return Boolean(status && !status.mergedIntoBase && w.branch !== status.baseBranch)
        if (filter === 'unpushed') return (status?.ahead ?? 0) > 0 || (status?.unpushed ?? 0) > 0
        if (filter === 'safe') {
          if (!status) return false
          return !(
            status.dirty ||
            status.staged ||
            status.ahead > 0 ||
            status.unpushed > 0 ||
            !status.mergedIntoBase ||
            status.hasOpenPR
          )
        }
        return true
      })
      .sort((a, b) => {
        if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
        return a.branch.localeCompare(b.branch)
      })
  }, [selectedRepo, worktrees, statuses, filter, search])

  const worktreeCountByRepo = useMemo(() => {
    const map = new Map<string, number>()
    for (const w of worktrees) {
      map.set(w.repositoryId, (map.get(w.repositoryId) ?? 0) + 1)
    }
    return map
  }, [worktrees])

  const handleDelete = async (path: string) => {
    const w = worktrees.find((x) => x.path === path)
    if (!w) return
    if (w.isMain) {
      window.alert('The primary worktree cannot be deleted from here.')
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
          `Move worktree to Trash?\n${shortenPath(path)}\n\nThis uses the system Trash and can be restored.`
        )
        if (!ok) return
      }
    } else {
      const ok = window.confirm(
        `Move worktree to Trash?\n${shortenPath(path)}\n\nThis uses the system Trash and can be restored.`
      )
      if (!ok) return
    }

    try {
      await api.trashWorktree(path)
      const next = worktrees.filter((x) => x.path !== path)
      setWorktrees(next)
      await api.setWorktrees(next)
    } catch (err) {
      setActionError(String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Worktree Manager"
        trailing={
          <>
            <button
              onClick={loadStatuses}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              title="Refresh statuses"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
            <button
              onClick={() => setView('settings')}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </button>
          </>
        }
      />

      {actionError && (
        <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <span className="truncate">{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-3 shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Projects
              </span>
              <button
                onClick={() => setView('onboarding')}
                className="rounded-md p-1 text-muted hover:bg-accent hover:text-foreground"
                title="Add repositories"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Filter projects…"
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {sortedRepos.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">No projects yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {sortedRepos.map((repo) => {
                  const active = repo.id === selectedRepositoryId
                  const count = worktreeCountByRepo.get(repo.id) ?? 0
                  return (
                    <li key={repo.id}>
                      <div
                        className={cn(
                          'group flex w-full items-start gap-1 rounded-lg pr-1 transition-colors',
                          active
                            ? 'bg-primary/15 text-foreground ring-1 ring-primary/30'
                            : 'text-foreground/80 hover:bg-accent'
                        )}
                      >
                        <button
                          onClick={() => setSelectedRepositoryId(repo.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left"
                        >
                          <FolderGit2
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              active ? 'text-primary' : 'text-muted'
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">
                              {repo.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {count} worktree{count === 1 ? '' : 's'}
                              {repo.preferredEditor
                                ? ` · ${editorLabel(repo.preferredEditor)}`
                                : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => updateRepo(repo.id, { favorite: !repo.favorite })}
                          className={cn(
                            'mt-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100',
                            repo.favorite
                              ? 'text-warning opacity-100'
                              : 'text-muted hover:text-warning'
                          )}
                          title={repo.favorite ? 'Remove favorite' : 'Add favorite'}
                        >
                          <Star
                            className={cn('h-3.5 w-3.5', repo.favorite && 'fill-warning')}
                          />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selectedRepo ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold tracking-tight">
                      {selectedRepo.name}
                    </h2>
                    <button
                      onClick={() =>
                        updateRepo(selectedRepo.id, { favorite: !selectedRepo.favorite })
                      }
                      className={cn(
                        'rounded p-1',
                        selectedRepo.favorite
                          ? 'text-warning'
                          : 'text-muted hover:text-warning'
                      )}
                      title={selectedRepo.favorite ? 'Unfavorite' : 'Favorite'}
                    >
                      <Star
                        className={cn(
                          'h-4 w-4',
                          selectedRepo.favorite && 'fill-warning'
                        )}
                      />
                    </button>
                    {selectedRepo.provider && (
                      <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        {selectedRepo.provider.type === 'github' ? 'GitHub' : 'Azure'}
                        {selectedRepo.provider.source === 'remote' ? ' · auto' : ''}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-0.5 truncate font-mono text-xs text-muted"
                    title={selectedRepo.path}
                  >
                    {shortenPath(selectedRepo.path)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Per-project editor — primary control on the main screen */}
                  <label className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                    <span className="text-muted">Open with</span>
                    <div className="relative">
                      <select
                        value={selectedRepo.preferredEditor || ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateRepo(selectedRepo.id, {
                            preferredEditor: v || undefined,
                          })
                        }}
                        className="appearance-none bg-transparent pr-5 font-medium outline-none"
                        title="Editor for this project"
                      >
                        <option value="">
                          App default ({editorLabel(settings?.defaultEditor)})
                        </option>
                        {EDITOR_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    </div>
                  </label>

                  <button
                    onClick={() => setConfigRepoId(selectedRepo.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Configure
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search branches or paths…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
                  {(['all', 'dirty', 'unmerged', 'unpushed', 'safe'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        'rounded px-2.5 py-1 text-[11px] font-medium capitalize',
                        filter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted hover:bg-accent hover:text-foreground'
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {loading && (
                  <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Fetching worktree statuses…
                  </div>
                )}
                {repoWorktrees.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
                    <p className="text-sm">No worktrees match this filter.</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    {repoWorktrees.map((w) => (
                      <WorktreeRow
                        key={w.id}
                        worktree={w}
                        repository={selectedRepo}
                        status={statuses[w.id]}
                        editorId={effectiveEditor}
                        onDelete={handleDelete}
                        onActionError={setActionError}
                        onRefresh={loadStatuses}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
              <FolderGit2 className="h-10 w-10 opacity-40" />
              <p className="text-sm">Select a project on the left.</p>
              <button
                onClick={() => setView('onboarding')}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
                Add repositories
              </button>
            </div>
          )}
        </main>
      </div>

      {configRepoId && (
        <ProjectConfigModal
          repository={repositories.find((r) => r.id === configRepoId)!}
          onClose={() => setConfigRepoId(null)}
          onSave={async (repo) => {
            const next = repositories.map((r) => (r.id === repo.id ? repo : r))
            await persistRepos(next)
            setConfigRepoId(null)
            loadStatuses()
          }}
        />
      )}
    </div>
  )
}
