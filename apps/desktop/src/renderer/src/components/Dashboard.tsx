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
  ArrowDownUp,
  Clock3,
  ShieldCheck,
} from 'lucide-react'
import type {
  AppSettings,
  Repository,
  RepositoryBaseStatus,
  Worktree,
  WorktreeSort,
  WorktreeSortDirection,
  WorktreeStatus,
} from '@worktree/contracts'
import { useAppStore } from '../store'
import { useDashboard, defaultDirectionFor } from '../hooks/useDashboard'
import { api } from '../api'
import { WorktreeRow } from './WorktreeRow'
import { ProjectConfigModal } from './ProjectConfigModal'
import { Loading } from './Loading'
import { EditorPicker } from './EditorPicker'
import { TitleBar } from './TitleBar'
import { BaseBranchStatus } from './BaseBranchStatus'
import { cn } from '../lib/utils'
import {
  editorLabel,
  editorOptionsForIds,
  sortEditorOptions,
  type EditorOption,
  shortenPath,
} from '../lib/paths'

const SORT_MODES: { value: WorktreeSort; label: string }[] = [
  { value: 'activity', label: 'Recent activity' },
  { value: 'name', label: 'Branch name' },
  { value: 'safety', label: 'Cleanup readiness' },
]

function directionLabel(sort: WorktreeSort, direction: WorktreeSortDirection): string {
  if (sort === 'activity') return direction === 'desc' ? 'Newest first' : 'Oldest first'
  if (sort === 'name') return direction === 'asc' ? 'A–Z' : 'Z–A'
  return direction === 'asc' ? 'Cleanup first' : 'Active first'
}

interface DashboardSidebarProps {
  sortedRepos: Repository[]
  selectedRepositoryId: string | null
  projectSearch: string
  setProjectSearch: (value: string) => void
  worktreeCountByRepo: Map<string, number>
  selectRepository: (id: string) => void
  updateRepo: (id: string, patch: Partial<Repository>) => void
}

function DashboardSidebar({
  sortedRepos,
  selectedRepositoryId,
  projectSearch,
  setProjectSearch,
  worktreeCountByRepo,
  selectRepository,
  updateRepo,
}: DashboardSidebarProps) {
  const setView = useAppStore((s) => s.setView)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Projects
          </span>
          <button
            type="button"
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
            aria-label="Filter projects"
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
                      type="button"
                      onClick={() => selectRepository(repo.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left"
                    >
                      {repo.imageUrl ? (
                        <img
                          src={repo.imageUrl}
                          alt=""
                          className="mt-0.5 h-4 w-4 shrink-0 rounded object-contain"
                        />
                      ) : (
                        <FolderGit2
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            active ? 'text-primary' : 'text-muted'
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{repo.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {count} worktree{count === 1 ? '' : 's'}
                          {repo.preferredEditor ? ` · ${editorLabel(repo.preferredEditor)}` : ''}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRepo(repo.id, { favorite: !repo.favorite })}
                      className={cn(
                        'mt-2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100',
                        repo.favorite ? 'text-warning opacity-100' : 'text-muted hover:text-warning'
                      )}
                      title={repo.favorite ? 'Remove favorite' : 'Add favorite'}
                    >
                      <Star className={cn('h-3.5 w-3.5', repo.favorite && 'fill-warning')} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

interface DashboardProjectHeaderProps {
  selectedRepo: Repository
  baseStatus: RepositoryBaseStatus | undefined
  baseBusy: boolean
  settings: AppSettings | null
  editorOptions: EditorOption[]
  editorIcons: Record<string, string>
  updateRepo: (id: string, patch: Partial<Repository>) => void
  setConfigRepoId: (value: string | null) => void
  loadStatuses: () => void
  updateSelectedBase: () => void
}

function DashboardProjectHeader({
  selectedRepo,
  baseStatus,
  baseBusy,
  settings,
  editorOptions,
  editorIcons,
  updateRepo,
  setConfigRepoId,
  loadStatuses,
  updateSelectedBase,
}: DashboardProjectHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {selectedRepo.imageUrl && (
            <img src={selectedRepo.imageUrl} alt="" className="h-5 w-5 rounded object-contain" />
          )}
          <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">
            {selectedRepo.name}
          </h2>
          <button
            type="button"
            onClick={() => updateRepo(selectedRepo.id, { favorite: !selectedRepo.favorite })}
            className={cn(
              'rounded p-1',
              selectedRepo.favorite ? 'text-warning' : 'text-muted hover:text-warning'
            )}
            title={selectedRepo.favorite ? 'Unfavorite' : 'Favorite'}
          >
            <Star className={cn('h-4 w-4', selectedRepo.favorite && 'fill-warning')} />
          </button>
          {selectedRepo.provider && (
            <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {selectedRepo.provider.type === 'github' ? 'GitHub' : 'Azure'}
              {selectedRepo.provider.source === 'remote' ? ' · auto' : ''}
            </span>
          )}
          <BaseBranchStatus
            status={baseStatus}
            busy={baseBusy}
            onRefresh={loadStatuses}
            onUpdate={updateSelectedBase}
          />
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted" title={selectedRepo.path}>
          {shortenPath(selectedRepo.path)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
          <span className="text-muted">Open with</span>
          <EditorPicker
            value={selectedRepo.preferredEditor || ''}
            defaultOptionLabel={`App default (${editorLabel(settings?.defaultEditor)})`}
            defaultEditorId={settings?.defaultEditor}
            options={editorOptions}
            editorIcons={editorIcons}
            onChange={(value) => {
              updateRepo(selectedRepo.id, {
                preferredEditor: value || undefined,
              })
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => setConfigRepoId(selectedRepo.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Configure
        </button>
      </div>
    </div>
  )
}

interface DashboardControlsProps {
  search: string
  setSearch: (value: string) => void
  filter: 'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'
  setFilter: (value: 'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe') => void
  sortMode: WorktreeSort
  sortDirection: WorktreeSortDirection
  updateWorktreeSort: (sort: WorktreeSort, direction: WorktreeSortDirection) => void
}

function DashboardControls({
  search,
  setSearch,
  filter,
  setFilter,
  sortMode,
  sortDirection,
  updateWorktreeSort,
}: DashboardControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
      <div className="relative min-w-[180px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search branches or paths…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search branches or paths"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
        {(['all', 'dirty', 'unmerged', 'unpushed', 'safe'] as const).map((f) => (
          <button
            type="button"
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
      <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs">
        {sortMode === 'activity' ? (
          <Clock3 className="h-3.5 w-3.5 text-primary" />
        ) : sortMode === 'safety' ? (
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
        ) : (
          <ArrowDownUp className="h-3.5 w-3.5 text-primary" />
        )}
        <span className="text-muted">Sort</span>
        <div className="relative">
          <select
            aria-label="Sort worktrees by"
            value={sortMode}
            onChange={(e) => {
              const nextSort = e.target.value as WorktreeSort
              void updateWorktreeSort(nextSort, defaultDirectionFor(nextSort))
            }}
            className="appearance-none bg-transparent pr-4 font-medium outline-none"
          >
            {SORT_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
        </div>
        <button
          type="button"
          onClick={() =>
            void updateWorktreeSort(sortMode, sortDirection === 'asc' ? 'desc' : 'asc')
          }
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-accent hover:text-foreground"
          title={`Reverse ordering (${directionLabel(sortMode, sortDirection)})`}
          aria-label={`Reverse ordering, currently ${directionLabel(sortMode, sortDirection)}`}
        >
          <span>{directionLabel(sortMode, sortDirection)}</span>
          <ArrowDownUp className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

interface DashboardWorktreeListProps {
  loading: boolean
  statusProgress: { current: number; total: number } | null
  baseStatusProgress: { current: number; total: number } | null
  worktreeSections: ReturnType<typeof import('../lib/worktreeSorting').groupWorktrees>
  repoWorktrees: Worktree[]
  statuses: Record<string, WorktreeStatus>
  refreshingIds: Set<string>
  effectiveEditor: string
  selectedRepo: Repository
  handleDelete: (w: Worktree) => void
  onActionError: (message: string) => void
  loadStatuses: () => void
  refreshWorktreeStatus: (w: Worktree) => Promise<void>
  onBranchChange: (worktreeId: string, branch: string) => void
}

function DashboardWorktreeList({
  loading,
  statusProgress,
  baseStatusProgress,
  worktreeSections,
  repoWorktrees,
  statuses,
  refreshingIds,
  effectiveEditor,
  selectedRepo,
  handleDelete,
  onActionError,
  loadStatuses,
  refreshWorktreeStatus,
  onBranchChange,
}: DashboardWorktreeListProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-4">
          <Loading
            message="Fetching base branches…"
            subMessage={
              baseStatusProgress && baseStatusProgress.total > 0
                ? `${baseStatusProgress.current}/${baseStatusProgress.total}`
                : undefined
            }
          />
          <Loading
            message="Fetching worktree statuses…"
            subMessage={
              statusProgress && statusProgress.total > 0
                ? `${statusProgress.current}/${statusProgress.total}`
                : undefined
            }
          />
        </div>
      )}
      <div className="h-full overflow-auto p-4">
        {repoWorktrees.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <p className="text-sm">No worktrees match this filter.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {worktreeSections.map((section, sectionIndex) => (
              <section
                key={section.key}
                className={cn(sectionIndex > 0 && 'border-t border-border')}
              >
                {section.label && (
                  <div className="flex items-center justify-between border-b border-border bg-accent/35 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {section.key === 'safe' ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <ArrowDownUp className="h-3.5 w-3.5" />
                      )}
                      {section.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted/80">
                      {section.worktrees.length}
                    </span>
                  </div>
                )}
                {section.worktrees.map((w) => (
                  <WorktreeRow
                    key={w.id}
                    worktree={w}
                    repository={selectedRepo}
                    status={statuses[w.id]}
                    refreshing={refreshingIds.has(w.id)}
                    editorId={effectiveEditor}
                    onDelete={handleDelete}
                    onActionError={onActionError}
                    onRefresh={loadStatuses}
                    onRefreshWorktree={refreshWorktreeStatus}
                    onBranchChange={onBranchChange}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardEmpty() {
  const setView = useAppStore((s) => s.setView)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
      <FolderGit2 className="h-10 w-10 opacity-40" />
      <p className="text-sm">Select a project on the left.</p>
      <button
        type="button"
        onClick={() => setView('onboarding')}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
      >
        <Plus className="h-4 w-4" />
        Add repositories
      </button>
    </div>
  )
}

export function Dashboard() {
  const ctx = useDashboard()
  const [availableEditorIds, setAvailableEditorIds] = useState<string[] | null>(null)
  const [editorIcons, setEditorIcons] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    api
      .getAvailableEditors()
      .then((ids) => {
        if (!cancelled) setAvailableEditorIds(ids)
      })
      .catch(() => {
        if (!cancelled) setAvailableEditorIds(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const editorOptions = useMemo(
    () =>
      sortEditorOptions(
        editorOptionsForIds(availableEditorIds, [
          ctx.settings?.defaultEditor,
          ctx.selectedRepo?.preferredEditor,
        ])
      ),
    [availableEditorIds, ctx.settings?.defaultEditor, ctx.selectedRepo?.preferredEditor]
  )

  useEffect(() => {
    const editorIds = editorOptions.map((option) => option.id)
    if (editorIds.length === 0) {
      setEditorIcons({})
      return
    }

    let cancelled = false
    api
      .getEditorIcons(editorIds)
      .then((icons) => {
        if (!cancelled) setEditorIcons(icons)
      })
      .catch(() => {
        if (!cancelled) setEditorIcons({})
      })

    return () => {
      cancelled = true
    }
  }, [editorOptions])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <TitleBar
        title="Worktree Manager"
        trailing={
          <>
            <button
              type="button"
              onClick={ctx.rescan}
              disabled={ctx.loading || ctx.scanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              title="Refresh worktrees and statuses"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', (ctx.loading || ctx.scanning) && 'animate-spin')}
              />
              {ctx.scanning ? 'Scanning…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => ctx.setView('settings')}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </button>
          </>
        }
      />

      {ctx.actionError && (
        <div className="flex items-start justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {/* Sync reports are several lines (what happened, which files, how to
              recover), so this wraps rather than truncating them away. */}
          <span className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-line break-words leading-relaxed">
            {ctx.actionError}
          </span>
          <button
            type="button"
            onClick={() => ctx.setActionError(null)}
            className="ml-3 shrink-0 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <DashboardSidebar
          sortedRepos={ctx.sortedRepos}
          selectedRepositoryId={ctx.selectedRepositoryId}
          projectSearch={ctx.projectSearch}
          setProjectSearch={ctx.setProjectSearch}
          worktreeCountByRepo={ctx.worktreeCountByRepo}
          selectRepository={ctx.selectRepository}
          updateRepo={ctx.updateRepo}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {ctx.scanning && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-4">
              <Loading
                message="Scanning…"
                subMessage={
                  ctx.scanProgress
                    ? `${ctx.scanProgress.found} found · ${ctx.scanProgress.current} folders`
                    : undefined
                }
              />
            </div>
          )}
          {ctx.selectedRepo ? (
            <>
              <DashboardProjectHeader
                selectedRepo={ctx.selectedRepo}
                baseStatus={ctx.baseStatuses[ctx.selectedRepo.id]}
                baseBusy={ctx.loading || ctx.baseUpdating}
                settings={ctx.settings}
                editorOptions={editorOptions}
                editorIcons={editorIcons}
                updateRepo={ctx.updateRepo}
                setConfigRepoId={ctx.setConfigRepoId}
                loadStatuses={() => {
                  void ctx.loadStatuses()
                }}
                updateSelectedBase={ctx.updateSelectedBase}
              />
              <DashboardControls
                search={ctx.search}
                setSearch={ctx.setSearch}
                filter={ctx.filter}
                setFilter={ctx.setFilter}
                sortMode={ctx.sortMode}
                sortDirection={ctx.sortDirection}
                updateWorktreeSort={ctx.updateWorktreeSort}
              />
              <DashboardWorktreeList
                loading={ctx.loading}
                statusProgress={ctx.statusProgress}
                baseStatusProgress={ctx.baseStatusProgress}
                worktreeSections={ctx.worktreeSections}
                repoWorktrees={ctx.repoWorktrees}
                statuses={ctx.statuses}
                refreshingIds={ctx.refreshingIds}
                effectiveEditor={ctx.effectiveEditor}
                selectedRepo={ctx.selectedRepo}
                handleDelete={ctx.handleDelete}
                onActionError={ctx.onActionError}
                loadStatuses={() => {
                  void ctx.loadStatuses()
                }}
                refreshWorktreeStatus={ctx.refreshWorktreeStatus}
                onBranchChange={ctx.onBranchChange}
              />
            </>
          ) : (
            <DashboardEmpty />
          )}
        </main>
      </div>

      {ctx.configRepoId && (
        <ProjectConfigModal
          repository={ctx.repositories.find((r) => r.id === ctx.configRepoId)!}
          onClose={() => ctx.setConfigRepoId(null)}
          onSave={ctx.saveRepository}
        />
      )}
    </div>
  )
}
