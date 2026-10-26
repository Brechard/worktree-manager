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
  HardDrive,
  Trash2,
} from 'lucide-react'
import type {
  AppSettings,
  Repository,
  RepositoryBaseStatus,
  Worktree,
  WorktreeDiskUsage,
  WorktreeSort,
  WorktreeSortDirection,
  WorktreeStatus,
} from '@worktree/contracts'
import { formatBytes } from '@worktree/contracts'
import { useAppStore } from '../store'
import { useDashboard, defaultDirectionFor } from '../hooks/useDashboard'
import { api } from '../api'
import { WorktreeRow } from './WorktreeRow'
import type { ProjectCatchUp } from '../lib/catchUp'
import { ProjectConfigModal, type ProjectConfigSection } from './ProjectConfigModal'
import { NewWorktreeModal } from './NewWorktreeModal'
import { CleanupCandidatesModal } from './CleanupCandidatesModal'
import { Loading } from './Loading'
import { EditorPicker } from './EditorPicker'
import { TitleBar } from './TitleBar'
import { BaseBranchStatus } from './BaseBranchStatus'
import { ProviderHealth } from './ProviderHealth'
import { CleaningArtwork } from './CleaningArtwork'
const appIcon = new URL('../../../../resources/icon.png', import.meta.url).href
import { cn } from '../lib/utils'
import { Button } from './ui/Button'
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
  projectCount: number
  setProjectSearch: (value: string) => void
  worktreeCountByRepo: Map<string, number>
  busyRepoIds: Set<string>
  erroredRepoIds: Set<string>
  selectRepository: (id: string) => void
  updateRepo: (id: string, patch: Partial<Repository>) => void
}

function DashboardSidebar({
  sortedRepos,
  selectedRepositoryId,
  projectSearch,
  projectCount,
  setProjectSearch,
  worktreeCountByRepo,
  busyRepoIds,
  erroredRepoIds,
  selectRepository,
  updateRepo,
}: DashboardSidebarProps) {
  const setView = useAppStore((s) => s.setView)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border p-4">
        <div className="mb-5 flex items-center gap-2.5 pt-1">
          <img src={appIcon} alt="" className="h-9 w-9 rounded-lg" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Worktree Manager
          </span>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
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
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-[13px] outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {sortedRepos.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted">
            <p>{projectCount > 0 ? 'No projects match your search.' : 'No projects yet.'}</p>
            {projectSearch && (
              <button
                type="button"
                onClick={() => setProjectSearch('')}
                className="mt-2 font-medium text-primary hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sortedRepos.map((repo) => {
              const active = repo.id === selectedRepositoryId
              const count = worktreeCountByRepo.get(repo.id) ?? 0
              // Work runs per project now, so a project can be mid-refresh
              // while you're looking at another one — say so here rather than
              // letting it finish invisibly.
              const busy = busyRepoIds.has(repo.id)
              const errored = erroredRepoIds.has(repo.id)
              return (
                <li key={repo.id}>
                  <div
                    className={cn(
                      'group flex w-full items-start gap-1 rounded-xl pr-1 transition-colors',
                      active
                        ? 'bg-primary/10 text-foreground ring-1 ring-primary/20'
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
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-medium">
                            {repo.name}
                          </span>
                          {busy && (
                            <RefreshCw
                              className="h-3 w-3 shrink-0 animate-spin text-muted"
                              aria-label="Refreshing"
                            />
                          )}
                          {errored && !busy && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                              title="This project has an unread error"
                            />
                          )}
                        </span>
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
  /** Totals across the project's worktrees, and how much of it is generated. */
  disk: { totalBytes: number; reclaimableBytes: number; measuring: boolean }
  cleanupSummary: { ready: number; review: number; bytes: number; measuring: boolean }
  openCleanupCandidates: () => void
  remeasureDisk: () => void
  updateRepo: (id: string, patch: Partial<Repository>) => void
  setConfigRepoId: (value: string | null) => void
  openNewWorktree: () => void
  setupRunningCount: number
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
  disk,
  cleanupSummary,
  openCleanupCandidates,
  remeasureDisk,
  updateRepo,
  setConfigRepoId,
  openNewWorktree,
  setupRunningCount,
  loadStatuses,
  updateSelectedBase,
}: DashboardProjectHeaderProps) {
  return (
    <div className="grid gap-3 border-b border-border px-5 py-4">
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
        <Button variant="primary" onClick={openNewWorktree} className="shrink-0">
          <Plus className="h-3.5 w-3.5" /> New worktree
        </Button>
        <ProjectStorageActions
          repositoryName={selectedRepo.name}
          setupRunningCount={setupRunningCount}
          disk={disk}
          cleanupSummary={cleanupSummary}
          remeasureDisk={remeasureDisk}
          openCleanupCandidates={openCleanupCandidates}
        />
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

        <Button
          variant="neutral"
          onClick={() => setConfigRepoId(selectedRepo.id)}
          className="shrink-0"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Configure
        </Button>
      </div>
    </div>
  )
}

function ProjectStorageActions({
  repositoryName,
  setupRunningCount,
  disk,
  cleanupSummary,
  remeasureDisk,
  openCleanupCandidates,
}: {
  repositoryName: string
  setupRunningCount: number
  disk: DashboardProjectHeaderProps['disk']
  cleanupSummary: DashboardProjectHeaderProps['cleanupSummary']
  remeasureDisk: () => void
  openCleanupCandidates: () => void
}) {
  const cleanupCount = cleanupSummary.ready + cleanupSummary.review
  return (
    <>
      {setupRunningCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-xs font-medium text-primary"
          role="status"
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {setupRunningCount} setup{setupRunningCount === 1 ? '' : 's'} running
        </span>
      )}
      {/* Every worktree of this project is a full copy of its dependencies
            and build output, so the project total is the number that explains
            where the disk went — and the button next to it is what gives it
            back. */}
      {(disk.totalBytes > 0 || disk.measuring) && (
        <Button
          variant="neutral"
          onClick={remeasureDisk}
          className="shrink-0"
          title={`Every worktree of ${repositoryName}, measured on disk${
            disk.reclaimableBytes > 0
              ? `. ${formatBytes(disk.reclaimableBytes)} of it is generated (dependencies, build output) and rebuilds from source.`
              : '.'
          }\n\nClick to measure again.`}
        >
          {disk.measuring ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted" />
          ) : (
            <HardDrive className="h-3.5 w-3.5 text-muted" />
          )}
          {/* A partial sum is honest only if it says so — the "+" is what
                keeps a half-measured project from reading as a small one. */}
          <span className="font-medium">
            {formatBytes(disk.totalBytes)}
            {disk.measuring ? '+' : ''}
          </span>
          {disk.reclaimableBytes > 0 && (
            <span className="text-primary">· {formatBytes(disk.reclaimableBytes)} generated</span>
          )}
        </Button>
      )}

      {cleanupCount > 0 && (
        <Button
          variant="softWarning"
          onClick={openCleanupCandidates}
          className="shrink-0"
          title={
            `${cleanupSummary.ready} ready to clean` +
            (cleanupSummary.review > 0
              ? `\n${cleanupSummary.review} landed with changes to review`
              : '') +
            (cleanupSummary.bytes > 0
              ? `\n\nRemoving them reclaims up to ${formatBytes(cleanupSummary.bytes)} of allocated space.`
              : '')
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clean up {cleanupCount}
          {cleanupSummary.bytes > 0 && (
            <span className="font-normal opacity-80">
              {` · ${formatBytes(cleanupSummary.bytes)}${cleanupSummary.measuring ? '+' : ''}`}
            </span>
          )}
        </Button>
      )}
    </>
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
  selectedCount: number
  eligibleCount: number
  onSelectVisible: () => void
  onClearSelection: () => void
  onRemoveSelected: () => void
}

function DashboardControls({
  search,
  setSearch,
  filter,
  setFilter,
  sortMode,
  sortDirection,
  updateWorktreeSort,
  selectedCount,
  eligibleCount,
  onSelectVisible,
  onClearSelection,
  onRemoveSelected,
}: DashboardControlsProps) {
  return (
    <div className="grid gap-2 border-b border-border px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search branches or paths…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search branches or paths"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-[13px] outline-none focus:border-primary"
          />
        </div>
        {eligibleCount > 0 && (
          <Button variant="neutral" size="compact" onClick={onSelectVisible}>
            Select visible ({eligibleCount})
          </Button>
        )}
        {selectedCount > 0 && (
          <>
            <span className="text-[13px] font-medium text-foreground tabular-nums">
              {selectedCount} selected
            </span>
            <Button variant="quiet" size="compact" onClick={onClearSelection}>
              Clear
            </Button>
            <Button variant="danger" size="compact" onClick={onRemoveSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Remove selected
            </Button>
          </>
        )}
      </div>
      <div className="grid justify-items-start gap-2 xl:flex xl:items-center xl:justify-between">
        <div
          role="group"
          aria-label="Filter worktrees"
          className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
        >
          {(['all', 'dirty', 'unmerged', 'unpushed', 'safe'] as const).map((f) => (
            <Button
              variant={filter === f ? 'primary' : 'quiet'}
              size="compact"
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="capitalize"
            >
              {f}
            </Button>
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
              className="appearance-none bg-transparent pr-4 text-[13px] font-medium outline-none"
            >
              {SORT_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
          </div>
          <Button
            variant="quiet"
            size="compact"
            onClick={() =>
              void updateWorktreeSort(sortMode, sortDirection === 'asc' ? 'desc' : 'asc')
            }
            title={`Reverse ordering (${directionLabel(sortMode, sortDirection)})`}
            aria-label={`Reverse ordering, currently ${directionLabel(sortMode, sortDirection)}`}
          >
            <span>{directionLabel(sortMode, sortDirection)}</span>
            <ArrowDownUp className="h-3 w-3" />
          </Button>
        </div>
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
  diskUsage: Record<string, WorktreeDiskUsage>
  measuringIds: Set<string>
  reclaimSpace: (worktree: Worktree) => void
  refreshingIds: Set<string>
  cleaningIds: Set<string>
  pendingRemovals: Record<string, 'sweeping' | 'hidden'>
  search: string
  filter: 'all' | 'dirty' | 'unmerged' | 'unpushed' | 'safe'
  onClearFilters: () => void
  effectiveEditor: string
  selectedRepo: Repository
  catchUp: ProjectCatchUp
  handleDelete: (w: Worktree) => void
  onActionError: (message: string) => void
  loadStatuses: () => void
  refreshWorktreeStatus: (w: Worktree) => Promise<void>
  onBranchChange: (worktreeId: string, branch: string) => void
  selectedWorktreeIds: Set<string>
  onToggleSelection: (id: string) => void
  onReloadWorktrees: () => Promise<void>
}

function DashboardWorktreeList({
  loading,
  statusProgress,
  baseStatusProgress,
  worktreeSections,
  repoWorktrees,
  statuses,
  diskUsage,
  measuringIds,
  reclaimSpace,
  refreshingIds,
  cleaningIds,
  pendingRemovals,
  search,
  filter,
  onClearFilters,
  effectiveEditor,
  selectedRepo,
  catchUp,
  handleDelete,
  onActionError,
  loadStatuses,
  refreshWorktreeStatus,
  onBranchChange,
  selectedWorktreeIds,
  onToggleSelection,
  onReloadWorktrees,
}: DashboardWorktreeListProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-4">
          <Loading
            message={`Fetching ${selectedRepo.name} base branch…`}
            subMessage={
              baseStatusProgress && baseStatusProgress.total > 0
                ? `${baseStatusProgress.current}/${baseStatusProgress.total}`
                : undefined
            }
          />
          <Loading
            message={`Fetching ${selectedRepo.name} worktree statuses…`}
            subMessage={
              statusProgress && statusProgress.total > 0
                ? `${statusProgress.current}/${statusProgress.total}`
                : undefined
            }
          />
        </div>
      )}
      <div className="h-full overflow-auto px-5 py-5">
        {repoWorktrees.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted">
            <CleaningArtwork className="mb-1 w-44 max-w-[50vw]" />
            <p className="text-base font-medium text-foreground">
              {search || filter !== 'all'
                ? 'No matching worktrees'
                : 'This project has no worktrees yet'}
            </p>
            <p className="max-w-xs text-sm">
              {search || filter !== 'all'
                ? 'Try another search or clear the filters.'
                : 'New worktrees will appear here after the next scan.'}
            </p>
            {(search || filter !== 'all') && (
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {worktreeSections.map((section, sectionIndex) => (
              <section
                key={section.key}
                className={cn(sectionIndex > 0 && 'border-t border-border')}
              >
                {section.label && (
                  <div className="flex items-center justify-between border-b border-border bg-accent/35 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {section.key === 'safe' ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <ArrowDownUp className="h-3.5 w-3.5" />
                      )}
                      {section.label}
                    </span>
                    <span className="font-mono text-xs text-muted/80">
                      {section.worktrees.length}
                    </span>
                  </div>
                )}
                {section.worktrees.map((w) => (
                  <WorktreeRow
                    key={w.id}
                    removing={pendingRemovals[w.id] === 'sweeping'}
                    worktree={w}
                    repository={selectedRepo}
                    status={statuses[w.id]}
                    refreshing={refreshingIds.has(w.id)}
                    cleaning={cleaningIds.has(w.id)}
                    diskUsage={diskUsage[w.id]}
                    measuring={measuringIds.has(w.id)}
                    onReclaim={reclaimSpace}
                    editorId={effectiveEditor}
                    catchUp={catchUp}
                    onDelete={handleDelete}
                    onActionError={onActionError}
                    onRefresh={loadStatuses}
                    onRefreshWorktree={refreshWorktreeStatus}
                    onBranchChange={onBranchChange}
                    selected={selectedWorktreeIds.has(w.id)}
                    onToggleSelection={() => onToggleSelection(w.id)}
                    onReloadWorktrees={onReloadWorktrees}
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
      <CleaningArtwork className="w-52 max-w-[55vw]" />
      <p className="text-base font-medium text-foreground">Select a project to get started</p>
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

interface DashboardRepositoryContentProps {
  ctx: ReturnType<typeof useDashboard>
  disk: { totalBytes: number; reclaimableBytes: number; measuring: boolean }
  editorOptions: EditorOption[]
  editorIcons: Record<string, string>
  catchUp: ProjectCatchUp
  setConfigInitialSection: (section: ProjectConfigSection) => void
  setNewWorktreeRepoId: (id: string | null) => void
}

function DashboardRepositoryContent({
  ctx,
  disk,
  editorOptions,
  editorIcons,
  catchUp,
  setConfigInitialSection,
  setNewWorktreeRepoId,
}: DashboardRepositoryContentProps) {
  const selectedRepo = ctx.selectedRepo
  if (!selectedRepo) return null
  return (
    <>
      <DashboardProjectHeader
        selectedRepo={selectedRepo}
        baseStatus={ctx.baseStatuses[selectedRepo.id]}
        baseBusy={ctx.loading || ctx.baseUpdating || ctx.catchingUp}
        settings={ctx.settings}
        editorOptions={editorOptions}
        editorIcons={editorIcons}
        disk={disk}
        cleanupSummary={ctx.cleanupSummary}
        openCleanupCandidates={() => ctx.openCleanupCandidates(selectedRepo.id)}
        remeasureDisk={() => {
          void ctx.measureRepoDisk(selectedRepo.id, { refresh: true })
        }}
        updateRepo={ctx.updateRepo}
        setConfigRepoId={(id) => {
          setConfigInitialSection('general')
          ctx.setConfigRepoId(id)
        }}
        openNewWorktree={() => setNewWorktreeRepoId(selectedRepo.id)}
        setupRunningCount={
          ctx.worktrees.filter(
            (w) => w.repositoryId === selectedRepo.id && w.postCreateSetupState === 'running'
          ).length
        }
        loadStatuses={() => {
          void ctx.loadStatuses()
        }}
        updateSelectedBase={ctx.updateSelectedBase}
      />
      <ProviderHealth
        key={selectedRepo.id}
        repository={selectedRepo}
        statuses={ctx.statuses}
        worktrees={ctx.worktrees}
        onManageProject={() => {
          setConfigInitialSection('connection')
          ctx.setConfigRepoId(selectedRepo.id)
        }}
        onManageGlobal={() => ctx.openSettings('connections')}
        onRefresh={() => void ctx.loadStatuses()}
      />
      <DashboardControls
        search={ctx.search}
        setSearch={ctx.setSearch}
        filter={ctx.filter}
        setFilter={ctx.setFilter}
        sortMode={ctx.sortMode}
        sortDirection={ctx.sortDirection}
        updateWorktreeSort={ctx.updateWorktreeSort}
        selectedCount={ctx.selectedWorktreeIds.size}
        eligibleCount={
          ctx.repoWorktrees.filter(
            (w) => !w.isMain && !w.prunable && w.postCreateSetupState !== 'running'
          ).length
        }
        onSelectVisible={ctx.selectVisibleWorktrees}
        onClearSelection={ctx.clearWorktreeSelection}
        onRemoveSelected={ctx.openSelectedRemoval}
      />
      <DashboardWorktreeList
        loading={ctx.loading}
        statusProgress={ctx.statusProgress}
        baseStatusProgress={ctx.baseStatusProgress}
        worktreeSections={ctx.worktreeSections}
        repoWorktrees={ctx.repoWorktrees}
        statuses={ctx.statuses}
        diskUsage={ctx.diskUsage}
        measuringIds={ctx.measuringIds}
        reclaimSpace={(w) => void ctx.reclaimSpace(w)}
        refreshingIds={ctx.refreshingIds}
        cleaningIds={ctx.cleaningIds}
        pendingRemovals={ctx.pendingRemovals}
        search={ctx.search}
        filter={ctx.filter}
        onClearFilters={() => {
          ctx.setSearch('')
          ctx.setFilter('all')
        }}
        effectiveEditor={ctx.effectiveEditor}
        selectedRepo={selectedRepo}
        catchUp={catchUp}
        handleDelete={(worktree) =>
          worktree.prunable ? void ctx.handleDelete(worktree) : ctx.openWorktreeRemoval(worktree)
        }
        onActionError={ctx.onActionError}
        loadStatuses={() => {
          void ctx.loadStatuses()
        }}
        refreshWorktreeStatus={ctx.refreshWorktreeStatus}
        onBranchChange={ctx.onBranchChange}
        selectedWorktreeIds={ctx.selectedWorktreeIds}
        onToggleSelection={ctx.toggleWorktreeSelection}
        onReloadWorktrees={ctx.reloadPersistedWorktrees}
      />
    </>
  )
}

export function Dashboard() {
  const ctx = useDashboard()
  const [newWorktreeRepoId, setNewWorktreeRepoId] = useState<string | null>(null)
  const [configInitialSection, setConfigInitialSection] = useState<ProjectConfigSection>('general')
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

  // What the primary worktree's "back to base and update everything" would do.
  // Counted off the project's full worktree list rather than the filtered view,
  // since the sweep does not care what the search box is showing.
  const selectedRepoId = ctx.selectedRepo?.id
  const catchUp = useMemo<ProjectCatchUp>(() => {
    const repo = ctx.repositories.find((r) => r.id === selectedRepoId)
    const base = repo?.baseBranch || 'main'
    const baseState = selectedRepoId ? ctx.baseStatuses[selectedRepoId]?.state : undefined
    let worktreeCount = 0
    for (const w of ctx.worktrees) {
      if (w.repositoryId !== selectedRepoId || w.isMain || w.prunable) continue
      const branch = ctx.statuses[w.id]?.branch ?? w.branch
      if (branch === base || branch === 'HEAD') continue
      worktreeCount += 1
    }
    return {
      baseOutdated: baseState === 'behind' || baseState === 'diverged',
      worktreeCount,
      running: ctx.catchingUp,
      run: () => {
        if (selectedRepoId) void ctx.catchUpProject(selectedRepoId)
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedRepoId,
    ctx.repositories,
    ctx.worktrees,
    ctx.statuses,
    ctx.baseStatuses,
    ctx.catchingUp,
    ctx.catchUpProject,
  ])

  // The project's own footprint: the sum of what its worktrees measured, plus
  // whether anything is still being counted so the number can say so.
  const disk = useMemo(() => {
    let totalBytes = 0
    let reclaimableBytes = 0
    let measuring = false
    for (const w of ctx.worktrees) {
      if (w.repositoryId !== selectedRepoId || w.prunable) continue
      const usage = ctx.diskUsage[w.id]
      if (!usage) {
        measuring = true
        continue
      }
      totalBytes += usage.totalBytes
      reclaimableBytes += usage.reclaimableBytes
    }
    return { totalBytes, reclaimableBytes, measuring }
  }, [selectedRepoId, ctx.worktrees, ctx.diskUsage])

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
        title="Workspaces"
        trailing={
          <>
            <Button
              variant="neutral"
              size="compact"
              onClick={ctx.rescan}
              disabled={ctx.scanning}
              title="Rescan every project for worktrees and statuses"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', ctx.scanning && 'animate-spin')} />
              {ctx.scanning ? 'Scanning…' : 'Rescan all'}
            </Button>
            <Button variant="neutral" size="compact" onClick={() => ctx.openSettings()}>
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </Button>
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
          {ctx.failedRemovalId &&
            ctx.worktrees.some(
              (worktree) =>
                worktree.id === ctx.failedRemovalId &&
                worktree.repositoryId === ctx.selectedRepositoryId
            ) && (
              <button
                type="button"
                onClick={ctx.retryFailedRemoval}
                className="ml-3 shrink-0 font-semibold underline"
              >
                Retry removal
              </button>
            )}
          <button
            type="button"
            onClick={() => ctx.setActionError(null)}
            className="ml-3 shrink-0 underline"
          >
            Dismiss
          </button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {Object.keys(ctx.pendingRemovals).length > 0
          ? `Removing ${Object.keys(ctx.pendingRemovals).length} worktree${Object.keys(ctx.pendingRemovals).length === 1 ? '' : 's'}…`
          : ''}
      </span>

      <div className="flex min-h-0 flex-1">
        <DashboardSidebar
          sortedRepos={ctx.sortedRepos}
          selectedRepositoryId={ctx.selectedRepositoryId}
          projectSearch={ctx.projectSearch}
          projectCount={ctx.repositories.length}
          setProjectSearch={ctx.setProjectSearch}
          worktreeCountByRepo={ctx.worktreeCountByRepo}
          busyRepoIds={ctx.busyRepoIds}
          erroredRepoIds={ctx.erroredRepoIds}
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
            <DashboardRepositoryContent
              ctx={ctx}
              disk={disk}
              editorOptions={editorOptions}
              editorIcons={editorIcons}
              catchUp={catchUp}
              setConfigInitialSection={setConfigInitialSection}
              setNewWorktreeRepoId={setNewWorktreeRepoId}
            />
          ) : (
            <DashboardEmpty />
          )}
        </main>
      </div>

      {ctx.configRepoId && (
        <ProjectConfigModal
          repository={ctx.repositories.find((r) => r.id === ctx.configRepoId)!}
          initialSection={configInitialSection}
          onClose={() => ctx.setConfigRepoId(null)}
          onSave={ctx.saveRepository}
        />
      )}

      {newWorktreeRepoId &&
        (() => {
          const repository = ctx.repositories.find((item) => item.id === newWorktreeRepoId)
          return repository ? (
            <NewWorktreeModal
              repository={repository}
              onClose={() => setNewWorktreeRepoId(null)}
              onCreated={(result) => {
                if (!result.success || !result.worktree) return
                void ctx
                  .reloadPersistedWorktrees()
                  .then(() => ctx.refreshWorktreeStatus(result.worktree!))
                  .catch((error) =>
                    ctx.onActionError(`Could not refresh the new worktree: ${String(error)}`)
                  )
              }}
            />
          ) : null
        })()}

      {ctx.cleanupCandidates &&
        (() => {
          const repo = ctx.repositories.find((r) => r.id === ctx.cleanupCandidates!.repositoryId)
          if (!repo) return null
          return (
            <CleanupCandidatesModal
              repositoryName={repo.name}
              baseBranch={repo.baseBranch || 'main'}
              repository={repo}
              manual={ctx.cleanupCandidates.manual === true}
              candidates={ctx.cleanupCandidates.candidates}
              diskUsage={ctx.diskUsage}
              measuringIds={ctx.measuringIds}
              onCancel={ctx.dismissCleanupCandidates}
              onConfirm={(selected, permanent) =>
                void ctx.deleteCleanupCandidates(selected, permanent)
              }
            />
          )
        })()}
    </div>
  )
}
