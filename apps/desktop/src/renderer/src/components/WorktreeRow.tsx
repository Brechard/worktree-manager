import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Code2,
  Terminal,
  FolderOpen,
  Trash2,
  GitBranch,
  GitCommit,
  Clock,
  ExternalLink,
  Loader2,
  ChevronRight,
  ChevronDown,
  FileX,
  FilePlus,
  FileClock,
  Eye,
  Undo2,
  AlertTriangle,
  HardDrive,
  MoreHorizontal,
  Upload,
  RefreshCw,
} from 'lucide-react'
import type {
  ProjectAction,
  Repository,
  SyncBaseMode,
  SyncTarget,
  Worktree,
  WorktreeStatus,
  WorktreeDetails,
  WorktreeDiskUsage,
} from '@worktree/contracts'
import {
  branchCanHavePullRequest,
  cleanupCandidacy,
  formatBytes,
  updateOffers,
} from '@worktree/contracts'
import { cn } from '../lib/utils'
import { ACTION_ICONS } from '../lib/actionIcons'
import { shortenPath } from '../lib/paths'
import { api } from '../api'
import { GitActionsMenu, type MergeMode } from './GitActionsMenu'
import type { ProjectCatchUp } from '../lib/catchUp'
import { SyncButton } from './SyncButton'
import { DiffViewer } from './DiffViewer'
import { useFloatingMenu } from './useFloatingMenu'
import { Button } from './ui/Button'

type BusyKind =
  | 'editor'
  | 'terminal'
  | 'folder'
  | 'action'
  | 'pull'
  | 'rebase'
  | 'push'
  | 'commit'
  | 'updateBase'
  | 'checkout'
  | 'merge'
  | 'sync'
  | 'setup'

interface WorktreeRowProps {
  worktree: Worktree
  repository: Repository
  status?: WorktreeStatus | undefined
  /** A targeted re-sync of this row is in flight (git + PR lookup). */
  refreshing?: boolean | undefined
  /** The project's cleanup hook is running for this worktree. */
  cleaning?: boolean | undefined
  removing?: boolean | undefined
  /** What this worktree costs on disk, once measured. */
  diskUsage?: WorktreeDiskUsage | undefined
  /** A size measurement or a reclaim is in flight for this worktree. */
  measuring?: boolean | undefined
  /** Delete this worktree's generated directories (asks first). */
  onReclaim?: ((worktree: Worktree) => void) | undefined
  editorId: string
  /** The project-wide catch-up, passed only for the primary worktree. */
  catchUp?: ProjectCatchUp | undefined
  onDelete: (worktree: Worktree) => void
  onActionError?: ((message: string) => void) | undefined
  onRefresh?: (() => void) | undefined
  onRefreshWorktree?: ((worktree: Worktree) => Promise<void> | void) | undefined
  onBranchChange?: ((worktreeId: string, branch: string) => void) | undefined
  selected?: boolean | undefined
  onToggleSelection?: (() => void) | undefined
  onReloadWorktrees?: (() => Promise<void>) | undefined
}

const gitActions = new Set([
  'pull',
  'rebase',
  'push',
  'commit',
  'updateBase',
  'checkout',
  'merge',
  'sync',
])

/** File details belong to the expanded row and can load independently of git actions. */
function useWorktreeDetails({
  worktree,
  repository,
  expanded,
  onActionError,
  onRefresh,
  setBusy,
}: {
  worktree: Worktree
  repository: Repository
  expanded: boolean
  onActionError: WorktreeRowProps['onActionError']
  onRefresh: WorktreeRowProps['onRefresh']
  setBusy: (value: BusyKind | null) => void
}) {
  const [details, setDetails] = useState<WorktreeDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{
    path: string
    staged: boolean
    untracked: boolean
    diff: string
    fullDiff: string
  } | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  useEffect(() => {
    if (!expanded || details) return
    let cancelled = false
    setLoadingDetails(true)
    api
      .getWorktreeDetails({ worktree, repository })
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch((err) => onActionError?.(String(err)))
      .finally(() => {
        if (!cancelled) setLoadingDetails(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, worktree, repository, details, onActionError])

  const handleFileClick = async (file: { path: string; status: string }) => {
    const staged = details?.stagedFiles.some((f) => f.path === file.path) ?? false
    const untracked = details?.untrackedFiles.some((f) => f.path === file.path) ?? false
    if (selectedFile?.path === file.path) {
      setSelectedFile(null)
      return
    }
    setSelectedFile({ path: file.path, staged, untracked, diff: '', fullDiff: '' })
    setLoadingDiff(true)
    try {
      const [diff, fullDiff] = await Promise.all([
        api.getFileDiff({
          path: worktree.path,
          filePath: file.path,
          staged,
          untracked,
          fullContext: false,
        }),
        api.getFileDiff({
          path: worktree.path,
          filePath: file.path,
          staged,
          untracked,
          fullContext: true,
        }),
      ])
      setSelectedFile({ path: file.path, staged, untracked, diff, fullDiff })
    } catch (err) {
      onActionError?.(String(err))
      setSelectedFile({ path: file.path, staged, untracked, diff: '', fullDiff: '' })
    } finally {
      setLoadingDiff(false)
    }
  }

  const handleDiscardFile = async (file: { path: string; status: string }) => {
    const untracked = details?.untrackedFiles.some((f) => f.path === file.path) ?? false
    setBusy('commit')
    try {
      const res = await window.api.discardFile({
        path: worktree.path,
        filePath: file.path,
        untracked,
      })
      if (res.success === false) {
        onActionError?.(res.output || 'Discard failed')
        return
      }
      setSelectedFile(null)
      const d = await api.getWorktreeDetails({ worktree, repository })
      setDetails(d)
      onRefresh?.()
    } catch (err) {
      onActionError?.(String(err))
    } finally {
      setBusy(null)
    }
  }

  return {
    details,
    setDetails,
    loadingDetails,
    selectedFile,
    setSelectedFile,
    loadingDiff,
    handleFileClick,
    handleDiscardFile,
  }
}

/** Executes a row command and reconciles the visible git state and details. */
function makeRowCommandRunner({
  worktree,
  expanded,
  onRefreshWorktree,
  onRefresh,
  onActionError,
  setBusy,
  setDetails,
  setSelectedFile,
}: Pick<WorktreeRowProps, 'worktree' | 'onRefreshWorktree' | 'onRefresh' | 'onActionError'> & {
  expanded: boolean
  setBusy: (value: BusyKind | null) => void
  setDetails: ReturnType<typeof useWorktreeDetails>['setDetails']
  setSelectedFile: ReturnType<typeof useWorktreeDetails>['setSelectedFile']
}) {
  return async (
    kind: BusyKind,
    fn: () => Promise<{ success?: boolean; error?: string; output?: string } | string | void>
  ) => {
    setBusy(kind)
    const refresh = () => {
      if (kind === 'updateBase' || !onRefreshWorktree) return onRefresh?.()
      return onRefreshWorktree(worktree)
    }
    const reconcile = () => {
      if (kind !== 'updateBase') void onRefreshWorktree?.(worktree)
    }
    try {
      const result = await fn()
      const failed =
        result && typeof result === 'object' && 'success' in result && result.success === false
      if (failed) {
        onActionError?.(result.error || result.output || `${kind} failed`)
        if (gitActions.has(kind)) reconcile()
      } else if (typeof result === 'string' && result.length > 0) {
        onActionError?.(result)
      } else if (gitActions.has(kind)) {
        await refresh()
        if (expanded) {
          setDetails(null)
          setSelectedFile(null)
        }
      }
    } catch (err) {
      onActionError?.(String(err))
      if (gitActions.has(kind)) reconcile()
    } finally {
      setBusy(null)
    }
  }
}

/** A recommended sync mode is valid only for the refs and commit that produced it. */
function useRowSync({
  worktree,
  repository,
  status,
  run,
  onActionError,
}: {
  worktree: Worktree
  repository: Repository
  status: WorktreeStatus | undefined
  run: ReturnType<typeof makeRowCommandRunner>
  onActionError: WorktreeRowProps['onActionError']
}) {
  // Set when a sync came back saying another mode is the one that works, so the
  // next click runs that instead of walking into the same wall again. Kept per
  // target: what a rebase proved about the base says nothing about the upstream.
  const syncSignature = `${status?.baseRef ?? ''}:${status?.behindBase ?? 0}:${status?.upstreamRef ?? ''}:${status?.behind ?? 0}:${status?.headCommit ?? ''}`
  const [learnedState, setLearnedState] = useState<{
    signature: string
    modes: Partial<Record<SyncTarget, SyncBaseMode>>
  } | null>(null)
  const learned = learnedState?.signature === syncSignature ? learnedState.modes : {}
  // Unlike the other git actions, a sync reports back even when it succeeds:
  // "already up to date" and "the rebase landed but your stash needs a hand" are
  // both outcomes the user has to see, not silent no-ops.
  const handleSync = (target: SyncTarget, mode: SyncBaseMode) =>
    // Pulling this branch's own upstream is a pull, not a base sync — labelling
    // the spinner by the target keeps the git menu's own entries honest too.
    run(target === 'base' ? 'sync' : mode === 'rebase' ? 'rebase' : 'pull', async () => {
      const result = await window.api.syncWithBase({
        path: worktree.path,
        baseBranch: repository.baseBranch,
        target,
        mode,
      })
      setLearnedState((current) => {
        const next = current?.signature === syncSignature ? { ...current.modes } : {}
        if (result.recommendedMode) next[target] = result.recommendedMode
        else delete next[target]
        return { signature: syncSignature, modes: next }
      })
      if (!result.success) return { success: false, output: result.output }
      if (result.outcome !== 'synced') onActionError?.(result.output)
      return undefined
    })

  return { learned, handleSync }
}

export function WorktreeRow(props: WorktreeRowProps) {
  const {
    worktree,
    repository,
    status,
    refreshing,
    cleaning,
    removing,
    diskUsage,
    measuring,
    onReclaim,
    editorId,
    catchUp,
    onDelete,
    onActionError,
    onRefresh,
    onRefreshWorktree,
    onBranchChange,
    selected,
    onToggleSelection,
    onReloadWorktrees,
  } = props

  const [busy, setBusy] = useState<BusyKind | null>(null)
  const [expanded, setExpanded] = useState(false)
  const {
    details,
    setDetails,
    loadingDetails,
    selectedFile,
    setSelectedFile,
    loadingDiff,
    handleFileClick,
    handleDiscardFile,
  } = useWorktreeDetails({ worktree, repository, expanded, onActionError, onRefresh, setBusy })
  const [commitMessage, setCommitMessage] = useState('')
  const [showCommitInput, setShowCommitInput] = useState(false)
  // Which custom action is running, so the spinner lands on the button that was
  // clicked rather than on all of them.
  const [runningActionId, setRunningActionId] = useState<string | null>(null)

  const run = makeRowCommandRunner({
    worktree,
    expanded,
    onRefreshWorktree,
    onRefresh,
    onActionError,
    setBusy,
    setDetails,
    setSelectedFile,
  })

  const handleOpen = () =>
    run('editor', () => window.api.openInEditor({ path: worktree.path, editor: editorId }))

  const handleTerminal = () =>
    run('terminal', () =>
      window.api.openInTerminal({
        path: worktree.path,
        ...(repository.workingSubdirectory ? { subdirectory: repository.workingSubdirectory } : {}),
      })
    )

  const handleFolder = () => run('folder', () => window.api.openInFileManager(worktree.path))

  const handleRetrySetup = () =>
    run('setup', async () => {
      const result = await api.retryWorktreeSetup({
        repositoryId: repository.id,
        worktreeId: worktree.id,
      })
      await onReloadWorktrees?.()
      await onRefreshWorktree?.(worktree)
      return result
    })

  // A terminal-mode action is handed off to the terminal, so this resolves as
  // soon as the window is up. A background one is awaited to the end, which is
  // also the only case where the row's git state can have moved underneath us.
  const handleAction = async (action: ProjectAction) => {
    setRunningActionId(action.id)
    try {
      await run('action', async () => {
        const result = await window.api.runProjectAction({
          command: action.command,
          worktreePath: worktree.path,
          repoPath: repository.path,
          branch: status?.branch ?? worktree.branch,
          repoName: repository.name,
          mode: action.mode,
          label: action.label,
          ...(repository.workingSubdirectory
            ? { subdirectory: repository.workingSubdirectory }
            : {}),
          ...(action.timeoutSeconds ? { timeoutSeconds: action.timeoutSeconds } : {}),
        })
        if (result.success) {
          if (result.output) console.info('[worktree] action:done', action.label, result.output)
          return undefined
        }
        const reason = result.timedOut
          ? `“${action.label}” timed out.`
          : `“${action.label}” failed${result.exitCode != null ? ` (exit ${result.exitCode})` : ''}.`
        return { success: false, output: result.output ? `${reason}\n\n${result.output}` : reason }
      })
      if (action.mode === 'background') await onRefreshWorktree?.(worktree)
    } finally {
      setRunningActionId(null)
    }
  }

  const handlePr = async () => {
    if (status?.pullRequest?.url) {
      await window.api.openExternal(status.pullRequest.url)
    }
  }

  const handlePush = () => run('push', () => window.api.pushWorktree(worktree.path))
  const handleUpdateBaseBranch = () =>
    run('updateBase', () =>
      window.api.updateBaseBranch({ path: worktree.path, baseBranch: repository.baseBranch })
    )

  const { learned, handleSync } = useRowSync({ worktree, repository, status, run, onActionError })

  // The git menu's explicit pull entries: same engine, same rollback, just with
  // the mode chosen by hand instead of from the branch's shape.
  const handlePull = () => handleSync('upstream', 'ff')
  const handleRebase = () => handleSync('upstream', 'rebase')

  const handleLoadBranches = () => window.api.getRepoBranches(worktree.path).then((r) => r.branches)
  const handleCheckout = (branch: string) => {
    onBranchChange?.(worktree.id, branch)
    run('checkout', () => window.api.checkoutBranch({ path: worktree.path, branch }))
  }
  const handleMerge = (branch: string, mode: MergeMode) =>
    run('merge', () => window.api.mergeBranch({ path: worktree.path, branch, mode }))

  const handleCommit = (all = false) => {
    if (!commitMessage.trim()) return
    run('commit', () =>
      window.api.commitWorktree({ path: worktree.path, message: commitMessage, all })
    )
    setCommitMessage('')
    setShowCommitInput(false)
  }

  const liveBranch = status?.branch ?? worktree.branch
  const detached = status?.detached ?? liveBranch === 'HEAD'
  const headCommit = status?.headCommit ?? worktree.headCommit
  const prunable = worktree.prunable === true
  const candidacy = cleanupCandidacy(worktree, status)
  const safe = candidacy?.kind === 'ready'
  const prTargetBranch = status?.pullRequest?.targetBranch
  const mergedIntoOtherBranch =
    status?.pullRequest?.state === 'merged' &&
    prTargetBranch !== undefined &&
    prTargetBranch !== status.baseBranch
  const prPending =
    refreshing === true &&
    repository.provider !== undefined &&
    !prunable &&
    branchCanHavePullRequest(liveBranch, status?.baseBranch ?? repository.baseBranch)

  return (
    <div
      className={cn(
        'border-b border-border last:border-b-0 hover:bg-row-hover',
        selected && 'bg-primary/5',
        removing && 'worktree-removing'
      )}
    >
      <WorktreeRowHeader
        worktree={worktree}
        status={status}
        repository={repository}
        busy={busy}
        cleaning={cleaning}
        diskUsage={diskUsage}
        measuring={measuring}
        onReclaim={onReclaim}
        liveBranch={liveBranch}
        detached={detached}
        headCommit={headCommit}
        prunable={prunable}
        safe={safe}
        candidacyKind={candidacy?.kind}
        selected={selected}
        onToggleSelection={onToggleSelection}
        handleRetrySetup={handleRetrySetup}
        prTargetBranch={prTargetBranch}
        mergedIntoOtherBranch={mergedIntoOtherBranch}
        prPending={prPending}
        expanded={expanded}
        setExpanded={setExpanded}
        catchUp={catchUp}
        showCommitInput={showCommitInput}
        setShowCommitInput={setShowCommitInput}
        onDelete={onDelete}
        handleOpen={handleOpen}
        handleTerminal={handleTerminal}
        handleFolder={handleFolder}
        handleAction={handleAction}
        runningActionId={runningActionId}
        handlePr={handlePr}
        handlePull={handlePull}
        handleRebase={handleRebase}
        handlePush={handlePush}
        handleUpdateBaseBranch={handleUpdateBaseBranch}
        handleCheckout={handleCheckout}
        handleMerge={handleMerge}
        handleSync={handleSync}
        learned={learned}
        handleLoadBranches={handleLoadBranches}
      />
      {expanded && (
        <WorktreeRowDetails
          worktree={worktree}
          repository={repository}
          details={details}
          loadingDetails={loadingDetails}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
          showCommitInput={showCommitInput}
          setShowCommitInput={setShowCommitInput}
          handleCommit={handleCommit}
          handleFileClick={handleFileClick}
          handleDiscardFile={handleDiscardFile}
          selectedFile={selectedFile}
          loadingDiff={loadingDiff}
          discarding={busy === 'commit'}
        />
      )}
    </div>
  )
}

function gitBusyLabel(kind: string, baseBranch: string): string {
  switch (kind) {
    case 'updateBase':
      return `Updating ${baseBranch}`
    case 'sync':
      return `Syncing with ${baseBranch}`
    case 'pull':
      return 'Pulling'
    case 'rebase':
      return 'Rebasing'
    case 'push':
      return 'Pushing'
    case 'commit':
      return 'Committing'
    case 'checkout':
      return 'Checking out'
    case 'merge':
      return 'Merging'
    default:
      return 'Working'
  }
}

/**
 * What this worktree costs, and the one-click way to give most of it back.
 *
 * The generated part is spelled out separately because that is the number that
 * can be acted on without losing anything: a branch that is still in flight
 * cannot be deleted, but its `node_modules` can, and it comes back with an
 * install. Without a size here, ten worktrees of one project look identical.
 */
function DiskUsageChip({
  worktree,
  usage,
  measuring,
  onReclaim,
}: {
  worktree: Worktree
  usage: WorktreeDiskUsage | undefined
  measuring: boolean
  onReclaim?: ((worktree: Worktree) => void) | undefined
}) {
  const icon = measuring ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <HardDrive className="h-3 w-3" />
  )

  if (!usage || usage.error) {
    return (
      <span className="inline-flex items-center gap-1" title={usage?.error}>
        {icon}
        {measuring ? 'measuring…' : '—'}
      </span>
    )
  }

  const canReclaim = !measuring && usage.reclaimableBytes > 0 && onReclaim !== undefined
  if (!canReclaim) {
    return (
      <span className="inline-flex items-center gap-1" title="Size on disk">
        {icon}
        {formatBytes(usage.totalBytes)}
      </span>
    )
  }

  const breakdown = usage.entries
    .slice(0, 6)
    .map((entry) => `  ${entry.path} — ${formatBytes(entry.bytes)}`)
    .join('\n')

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onReclaim?.(worktree)
      }}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
      title={
        `${formatBytes(usage.totalBytes)} on disk, ${formatBytes(usage.reclaimableBytes)} of it generated:\n${breakdown}` +
        `\n\nClick to delete these — they rebuild from source.`
      }
    >
      {icon}
      {formatBytes(usage.totalBytes)}
      <span className="text-primary">· reclaim ~{formatBytes(usage.reclaimableBytes)}</span>
    </button>
  )
}

interface WorktreeRowHeaderProps {
  worktree: Worktree
  status?: WorktreeStatus | undefined
  repository: Repository
  busy: BusyKind | null
  cleaning?: boolean | undefined
  diskUsage?: WorktreeDiskUsage | undefined
  measuring?: boolean | undefined
  onReclaim?: ((worktree: Worktree) => void) | undefined
  liveBranch: string
  detached: boolean
  headCommit: string | undefined
  prunable: boolean
  safe: boolean
  candidacyKind?: 'ready' | 'review' | undefined
  selected?: boolean | undefined
  onToggleSelection?: (() => void) | undefined
  handleRetrySetup: () => void
  prTargetBranch: string | undefined
  mergedIntoOtherBranch: boolean
  prPending: boolean
  expanded: boolean
  setExpanded: (v: React.SetStateAction<boolean>) => void
  catchUp?: ProjectCatchUp | undefined
  showCommitInput: boolean
  setShowCommitInput: (v: React.SetStateAction<boolean>) => void
  onDelete: (worktree: Worktree) => void
  handleOpen: () => void
  handleTerminal: () => void
  handleFolder: () => void
  handleAction: (action: ProjectAction) => void
  /** Id of the custom action currently running, if any. */
  runningActionId: string | null
  handlePr: () => Promise<void>
  handlePull: () => void
  handleRebase: () => void
  handlePush: () => void
  handleUpdateBaseBranch: () => void
  handleCheckout: (branch: string) => void
  handleMerge: (branch: string, mode: MergeMode) => void
  handleSync: (target: SyncTarget, mode: SyncBaseMode) => void
  /** Modes previous syncs proved to be the working ones, per target. */
  learned: Partial<Record<SyncTarget, SyncBaseMode>>
  handleLoadBranches: () => Promise<string[]>
}

function rowHeaderState({
  worktree,
  status,
  repository,
  catchUp,
  liveBranch,
  detached,
  prunable,
  busy,
}: WorktreeRowHeaderProps) {
  const prNumber = status?.pullRequest?.id.match(/^(?:gh|ado)-([1-9]\d*)$/)?.[1]
  const behindBase = status?.behindBase ?? 0
  const baseRef = status?.baseRef ?? repository.baseBranch
  // Everything this row could bring in — its own upstream first, then the base.
  // A stale worktree has no working tree to bring anything into.
  const offers = prunable ? [] : updateOffers(status)
  const upstreamOffer = offers.find((offer) => offer.target === 'upstream')
  const baseOffer = offers.find((offer) => offer.target === 'base')

  // The catch-up is worth offering on the primary worktree once the base has
  // moved on — either origin has commits the local base does not, or this
  // worktree is parked on a branch that already landed there and has nothing
  // left to do. Anything else and the primary is already where it should be.
  const baseMovedOn = catchUp?.baseOutdated === true || behindBase > 0
  const parkedOnMergedBranch =
    !detached &&
    liveBranch !== repository.baseBranch &&
    status?.mergedIntoBase === true &&
    status.hasMergedBranchHistory === true
  const offerCatchUp =
    catchUp &&
    worktree.isMain &&
    !prunable &&
    (catchUp.running || baseMovedOn || parkedOnMergedBranch)
      ? catchUp
      : undefined
  // Every row locks its git actions while the sweep runs, not just the one that
  // started it — it is replaying this worktree onto the base too.
  const projectBusy = catchUp?.running === true
  const setupRunning = worktree.postCreateSetupState === 'running'
  const setupInterrupted = worktree.postCreateSetupState === 'interrupted'
  // Whichever offer the button's main label is spelling out, so the status line
  // above it can leave that one count to the button.
  const spoken = offerCatchUp ? undefined : offers[0]?.target
  const speaksFor = { upstream: spoken === 'upstream', base: spoken === 'base' }
  const syncBusy = busy === 'sync' || busy === 'pull' || busy === 'rebase'

  return {
    prNumber,
    behindBase,
    baseRef,
    offers,
    upstreamOffer,
    baseOffer,
    offerCatchUp,
    projectBusy,
    setupRunning,
    setupInterrupted,
    speaksFor,
    syncBusy,
  }
}

function WorktreeRowHeader(props: WorktreeRowHeaderProps) {
  const { worktree, prunable, selected, onToggleSelection, liveBranch } = props
  const view = rowHeaderState(props)
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      {!worktree.isMain && !prunable && worktree.postCreateSetupState !== 'running' && (
        <input
          type="checkbox"
          checked={selected === true}
          onChange={onToggleSelection}
          aria-label={`Select ${liveBranch} for removal`}
          className="h-4 w-4 shrink-0 accent-primary"
        />
      )}
      <WorktreeRowIdentity {...props} view={view} />
      <WorktreeRowActions {...props} view={view} />
    </div>
  )
}

type RowIdentityProps = WorktreeRowHeaderProps & { view: ReturnType<typeof rowHeaderState> }

function WorktreeRowIdentity(props: RowIdentityProps) {
  const { prunable, expanded, setExpanded } = props
  return (
    <div
      onClick={() => !prunable && setExpanded((v) => !v)}
      onKeyDown={(event) => {
        if (prunable || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        setExpanded((value) => !value)
      }}
      role={prunable ? undefined : 'button'}
      tabIndex={prunable ? undefined : 0}
      aria-expanded={!prunable ? expanded : undefined}
      className={cn(
        'min-w-0 flex-[1_1_20rem] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        prunable ? 'cursor-default' : 'cursor-pointer'
      )}
      title={prunable ? undefined : 'Click for details'}
    >
      <RowBadges {...props} />
      <RowPullRequestAndPath {...props} />
      <RowExpandedMetadata {...props} />
    </div>
  )
}

function RowBadges(props: RowIdentityProps) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
      <RowBranchBadges {...props} />
      <RowSetupBadges {...props} />
      <RowActivityBadges {...props} />
    </div>
  )
}

function RowBranchBadges({
  worktree,
  liveBranch,
  detached,
  headCommit,
  prunable,
  expanded,
}: RowIdentityProps) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
        {!prunable &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 text-primary" />
          ) : (
            <ChevronRight className="h-3 w-3 text-primary" />
          ))}
        <GitBranch className="h-3 w-3 text-primary" />
        {detached ? (
          <>
            detached HEAD
            {headCommit && <span className="text-muted">@{headCommit}</span>}
          </>
        ) : (
          liveBranch
        )}
      </span>
      {worktree.isMain && (
        <span className="rounded-md bg-highlight/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-highlight">
          Primary
        </span>
      )}
      {prunable && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning"
          title={worktree.prunableReason || 'Working tree directory is missing'}
        >
          <AlertTriangle className="h-3 w-3" />
          Stale · folder missing
        </span>
      )}
    </>
  )
}

function RowSetupBadges({ worktree, view }: RowIdentityProps) {
  const { setupRunning, setupInterrupted } = view
  return (
    <>
      {setupRunning && (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          <Loader2 className="h-3 w-3 animate-spin" /> Setup running
        </span>
      )}
      {setupInterrupted && (
        <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
          <AlertTriangle className="h-3 w-3" /> Setup interrupted
        </span>
      )}
      {!setupRunning && !setupInterrupted && worktree.postCreateSetup?.success === false && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
          title={worktree.postCreateSetup.output || 'Post-create setup failed'}
        >
          <AlertTriangle className="h-3 w-3" /> Setup failed
        </span>
      )}
    </>
  )
}

function rowActivityLabel(
  setupRunning: boolean,
  status: WorktreeStatus | undefined,
  safe: boolean,
  candidacyKind: WorktreeRowHeaderProps['candidacyKind']
): string {
  if (setupRunning) return 'Setting up…'
  if (!status) return 'Checking status…'
  if (safe) return 'Ready to clean'
  return candidacyKind === 'review' ? 'Review changes' : 'Active work'
}

function RowActivityBadges({
  worktree,
  status,
  prunable,
  safe,
  candidacyKind,
  view,
}: RowIdentityProps) {
  const { setupRunning } = view
  return (
    <>
      {!worktree.isMain && !prunable && (
        <span className={cn('text-xs font-medium', safe ? 'text-success' : 'text-muted')}>
          {rowActivityLabel(setupRunning, status, safe, candidacyKind)}
        </span>
      )}
      {status && (status.dirty || status.staged || status.hasUntracked) && (
        <span className="text-xs text-muted">Changes</span>
      )}
      {status && (status.ahead > 0 || status.unpushed > 0) && (
        <span className="text-xs text-muted">Unpushed</span>
      )}
      {status?.prLookup?.state === 'error' && (
        <span className="text-xs font-medium text-warning" title={status.prLookup.error?.message}>
          PR check unavailable{status.pullRequest ? ' · last known PR shown' : ''}
        </span>
      )}
    </>
  )
}

function RowPullRequestAndPath(props: RowIdentityProps) {
  const { worktree } = props
  return (
    <div className="flex min-w-0 items-center gap-2">
      <RowPullRequestBadge {...props} />
      <p className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={worktree.path}>
        {worktree.path.split(/[\\/]/).filter(Boolean).at(-1) ?? worktree.path}
      </p>
    </div>
  )
}

function RowPullRequestBadge(props: RowIdentityProps) {
  const { status, liveBranch, prPending } = props
  if (status?.pullRequest)
    return <RowPullRequestLink {...props} status={status} pullRequest={status.pullRequest} />
  if (!prPending) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-muted"
      title={`Looking up the pull request for ${liveBranch}…`}
    >
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      pull request
    </span>
  )
}

function RowPullRequestLink({
  status,
  handlePr,
  mergedIntoOtherBranch,
  prTargetBranch,
  prPending,
  view,
  pullRequest,
}: RowIdentityProps & {
  status: WorktreeStatus
  pullRequest: NonNullable<WorktreeStatus['pullRequest']>
}) {
  const { prNumber } = view
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void handlePr()
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={`${status.prLookup?.state === 'error' ? 'Last known ' : ''}PR${prNumber ? ` #${prNumber}` : ''}, ${pullRequest.state}: ${pullRequest.title}`}
      className={cn(
        'inline-flex min-w-0 max-w-[min(320px,78%)] shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        status.prLookup?.state === 'error' && 'opacity-70',
        pullRequest.state === 'open' && 'bg-success/15 text-success',
        pullRequest.state === 'draft' && 'bg-muted/20 text-muted',
        pullRequest.state === 'closed' && 'bg-muted/20 text-muted',
        pullRequest.state === 'merged' && 'bg-merged/15 text-merged'
      )}
      title={
        mergedIntoOtherBranch
          ? `${pullRequest.title}\n\nMerged into ${prTargetBranch}, not into the configured base ${status.baseBranch}.`
          : pullRequest.title
      }
    >
      {prPending ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      ) : (
        <ExternalLink className="h-3 w-3 shrink-0" />
      )}
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {status.prLookup?.state === 'error' ? 'Last known ' : ''}PR
        {prNumber ? ` #${prNumber}` : ''} · {pullRequest.state}
      </span>
      <span aria-hidden="true" className="min-w-0 truncate">
        · {pullRequest.title}
      </span>
    </button>
  )
}

function RowExpandedMetadata(props: RowIdentityProps) {
  if (!props.expanded) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
      <RowPathAndDiskMetadata {...props} />
      <RowGitMetadata {...props} />
    </div>
  )
}

function RowPathAndDiskMetadata({
  worktree,
  diskUsage,
  measuring,
  onReclaim,
  headCommit,
  prunable,
}: RowIdentityProps) {
  return (
    <>
      <span className="font-mono" title="Full worktree path">
        {shortenPath(worktree.path)}
      </span>
      {headCommit && (
        <span className="inline-flex items-center gap-1">
          <GitCommit className="h-3 w-3" />
          {headCommit}
        </span>
      )}
      {worktree.lastModified !== undefined && (
        <span
          className="inline-flex items-center gap-1"
          title={`Last activity: ${new Date(worktree.lastModified).toLocaleString()}`}
        >
          <Clock className="h-3 w-3" />
          {new Date(worktree.lastModified).toLocaleDateString()}
        </span>
      )}
      {!prunable && (diskUsage || measuring) && (
        <DiskUsageChip
          worktree={worktree}
          usage={diskUsage}
          measuring={measuring === true}
          onReclaim={onReclaim}
        />
      )}
      {prunable && (
        <span className="inline-flex items-center gap-1 text-warning">
          <AlertTriangle className="h-3 w-3" />
          {worktree.prunableReason || 'Working tree directory is missing'}
        </span>
      )}
    </>
  )
}

function RowMergeMetadata({
  status,
  detached,
  candidacyKind,
  liveBranch,
  mergedIntoOtherBranch,
  prTargetBranch,
}: {
  status: WorktreeStatus
  detached: boolean
  candidacyKind: WorktreeRowHeaderProps['candidacyKind']
  liveBranch: string
  mergedIntoOtherBranch: boolean
  prTargetBranch: string | undefined
}) {
  return (
    <>
      {detached ? (
        <span className="text-muted">detached</span>
      ) : !status.mergedIntoBase && !candidacyKind && liveBranch !== status.baseBranch ? (
        status.baseFetchError ? (
          <span
            className="text-warning"
            title={`Could not fetch origin/${status.baseBranch}, so the merge check ran against a possibly-stale ref.\n\n${status.baseFetchError}`}
          >
            merge unknown
          </span>
        ) : (
          <span
            className="text-warning"
            title={
              mergedIntoOtherBranch
                ? `Merged into ${prTargetBranch}, but not into the configured base ${status.baseBranch}.`
                : `Not merged into ${status.baseBranch}`
            }
          >
            unmerged
          </span>
        )
      ) : null}
    </>
  )
}

function RowGitMetadata({
  status,
  prunable,
  liveBranch,
  detached,
  candidacyKind,
  mergedIntoOtherBranch,
  prTargetBranch,
  view,
}: RowIdentityProps) {
  const { behindBase, baseRef, speaksFor } = view
  return (
    <>
      {status && !prunable && (
        <>
          {status.dirty && <span>Modified files</span>}
          {status.staged && <span>Staged files</span>}
          {status.hasUntracked && <span>Untracked files</span>}
          {(status.ahead > 0 || status.unpushed > 0) && (
            <span>
              {status.ahead > 0 ? `${status.ahead} ahead` : `${status.unpushed} unpushed`}
            </span>
          )}
          {/* Only when the button is not already saying it — it spells out
                  the same count and ref, and printing both reads as noise. */}
          {status.behind > 0 && liveBranch !== status.baseBranch && !speaksFor.upstream && (
            <span title={`${status.behind} commit(s) on this branch's own upstream`}>
              {status.behind} behind upstream
            </span>
          )}
          {behindBase > 0 && !speaksFor.base && (
            <span
              className="text-primary"
              title={`${baseRef} has ${behindBase} commit(s) this branch has not integrated yet.`}
            >
              {behindBase} behind {baseRef}
            </span>
          )}
          <RowMergeMetadata
            status={status}
            detached={detached}
            candidacyKind={candidacyKind}
            liveBranch={liveBranch}
            mergedIntoOtherBranch={mergedIntoOtherBranch}
            prTargetBranch={prTargetBranch}
          />
        </>
      )}
    </>
  )
}

type RowActionsProps = WorktreeRowHeaderProps & { view: ReturnType<typeof rowHeaderState> }

function WorktreeRowActions(props: RowActionsProps) {
  const { prunable, worktree, onDelete } = props
  return (
    <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
      {prunable ? (
        <Button
          variant="softWarning"
          onClick={() => onDelete(worktree)}
          title="Remove this stale worktree entry from git"
        >
          <Trash2 className="h-3.5 w-3.5" /> Prune
        </Button>
      ) : (
        <>
          <RowActionStatus {...props} />
          <RowOpenAction {...props} />
          <RowRetryAction {...props} />
          <RowCollapsedGitActions {...props} />
          <RowExpandedGitActions {...props} />
        </>
      )}
    </div>
  )
}

function RowActionStatus({ busy, repository, view }: RowActionsProps) {
  const { offerCatchUp, projectBusy } = view
  return (
    <>
      {' '}
      {/* The primary row says it on the catch-up button itself; the rows
                being swept along have nothing else to show for it. */}
      {projectBusy && !offerCatchUp ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Project update running
        </span>
      ) : (
        busy &&
        gitActions.has(busy) && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {gitBusyLabel(busy, repository.baseBranch)}
          </span>
        )
      )}
    </>
  )
}

function RowOpenAction({ busy, handleOpen }: RowActionsProps) {
  return (
    <>
      {' '}
      <Button
        variant="neutral"
        onClick={handleOpen}
        disabled={busy === 'editor'}
        loading={busy === 'editor'}
        className="shadow-sm"
      >
        {busy === 'editor' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Code2 className="h-3.5 w-3.5" />
        )}
        Open
      </Button>
    </>
  )
}

function RowRetryAction({ worktree, busy, handleRetrySetup, view }: RowActionsProps) {
  const { setupRunning, setupInterrupted } = view
  return (
    <>
      {' '}
      {(setupInterrupted || (!setupRunning && worktree.postCreateSetup?.success === false)) && (
        <Button
          variant="softWarning"
          onClick={handleRetrySetup}
          disabled={Boolean(busy)}
          loading={busy === 'setup'}
          title={worktree.postCreateSetup?.output || 'Retry the project setup command'}
        >
          {busy === 'setup' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Retry setup
        </Button>
      )}
    </>
  )
}

function RowCollapsedGitActions(props: RowActionsProps) {
  const { repository, busy, expanded, liveBranch, learned, handleSync, view } = props
  const { offers, offerCatchUp, projectBusy, setupRunning, syncBusy } = view
  return (
    <>
      <RowPushAction {...props} />
      {!expanded && !setupRunning && (offers.length > 0 || offerCatchUp) && (
        <SyncButton
          offers={offers}
          baseBranch={repository.baseBranch}
          branch={liveBranch}
          learned={learned}
          catchUp={offerCatchUp}
          busy={syncBusy}
          disabled={setupRunning || (Boolean(busy) && !syncBusy) || (projectBusy && !offerCatchUp)}
          onSync={handleSync}
        />
      )}
    </>
  )
}

function RowPushAction({ status, busy, prunable, expanded, handlePush, view }: RowActionsProps) {
  const { projectBusy, setupRunning } = view
  return (
    <>
      {!expanded &&
        !projectBusy &&
        !setupRunning &&
        !prunable &&
        status?.hasRemote &&
        status.behind === 0 &&
        (status.ahead > 0 || (!status.hasUpstream && status.unpushed > 0)) && (
          <Button
            variant="softPrimary"
            onClick={handlePush}
            disabled={Boolean(busy)}
            loading={busy === 'push'}
            title={
              status.hasUpstream
                ? 'Push local commits to the upstream branch'
                : 'Publish this branch to the remote'
            }
          >
            {busy === 'push' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {status.hasUpstream ? `Push ${status.ahead}` : `Publish ${status.unpushed}`}
          </Button>
        )}
    </>
  )
}

function RowExpandedGitActions({
  worktree,
  repository,
  busy,
  cleaning,
  expanded,
  setExpanded,
  liveBranch,
  learned,
  handleAction,
  runningActionId,
  handleSync,
  showCommitInput,
  setShowCommitInput,
  handleLoadBranches,
  handlePull,
  handleRebase,
  handlePush,
  handleUpdateBaseBranch,
  handleCheckout,
  handleMerge,
  handleTerminal,
  handleFolder,
  onDelete,
  view,
}: RowActionsProps) {
  const { offers, offerCatchUp, projectBusy, setupRunning, syncBusy, baseOffer, upstreamOffer } =
    view
  return (
    <>
      {' '}
      {expanded &&
        repository.actions.map((action) => (
          <ActionButton
            key={action.id}
            action={action}
            subdirectory={repository.workingSubdirectory}
            running={runningActionId === action.id}
            disabled={setupRunning || (Boolean(busy) && runningActionId !== action.id)}
            onRun={handleAction}
          />
        ))}
      {expanded && (offers.length > 0 || offerCatchUp) && (
        <SyncButton
          offers={offers}
          baseBranch={repository.baseBranch}
          branch={liveBranch}
          learned={learned}
          catchUp={offerCatchUp}
          busy={syncBusy}
          disabled={setupRunning || (Boolean(busy) && !syncBusy) || (projectBusy && !offerCatchUp)}
          onSync={handleSync}
        />
      )}
      {expanded && (
        <GitActionsMenu
          busy={busy === 'setup' ? null : busy}
          branch={liveBranch}
          baseBranch={repository.baseBranch}
          showCommitInput={showCommitInput}
          loadBranches={handleLoadBranches}
          onPull={handlePull}
          onRebase={handleRebase}
          onPush={handlePush}
          onCommit={() => {
            setExpanded(true)
            setShowCommitInput(true)
          }}
          onUpdateBaseBranch={handleUpdateBaseBranch}
          onCheckout={handleCheckout}
          onMerge={handleMerge}
          onSync={handleSync}
          baseOffer={baseOffer}
          upstreamOffer={upstreamOffer}
          catchUp={offerCatchUp}
          blocked={projectBusy || setupRunning}
        />
      )}
      {expanded && (
        <MoreActionsMenu
          worktree={worktree}
          onTerminal={handleTerminal}
          onFolder={handleFolder}
          onDelete={onDelete}
          deleteDisabled={cleaning || setupRunning}
        />
      )}
    </>
  )
}

function MoreActionsMenu({
  worktree,
  onTerminal,
  onFolder,
  onDelete,
  deleteDisabled,
}: {
  worktree: Worktree
  onTerminal: () => void | Promise<void>
  onFolder: () => void | Promise<void>
  onDelete: (worktree: Worktree) => void
  deleteDisabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const { anchorRef, menuRef, triggerRef, menuId, position, closeWithFocus } = useFloatingMenu(
    open,
    setOpen
  )

  return (
    <div ref={anchorRef} className="relative">
      <Button
        ref={triggerRef}
        variant="neutral"
        onClick={() => setOpen((value) => !value)}
        aria-label="More worktree actions"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <MoreHorizontal className="h-3.5 w-3.5" /> More
      </Button>
      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            className="fixed z-50 flex min-w-44 flex-col rounded-xl border border-border bg-card p-1.5 shadow-lg"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight,
              overflowY: position?.maxHeight === undefined ? undefined : 'auto',
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => {
                closeWithFocus()
                void onTerminal()
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-accent"
            >
              <Terminal className="h-4 w-4" />
              Open in terminal
            </button>
            <button
              type="button"
              onClick={() => {
                closeWithFocus()
                void onFolder()
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-accent"
            >
              <FolderOpen className="h-4 w-4" />
              Reveal in Finder
            </button>
            {!worktree.isMain && (
              <button
                type="button"
                onClick={() => {
                  closeWithFocus()
                  onDelete(worktree)
                }}
                disabled={deleteDisabled}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Move to Trash
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

interface WorktreeRowDetailsProps {
  worktree: Worktree
  repository: Repository
  details: WorktreeDetails | null
  loadingDetails: boolean
  commitMessage: string
  setCommitMessage: (v: string) => void
  showCommitInput: boolean
  setShowCommitInput: (v: React.SetStateAction<boolean>) => void
  handleCommit: (all?: boolean) => void
  handleFileClick: (file: { path: string; status: string }) => void | Promise<void>
  handleDiscardFile: (file: { path: string; status: string }) => void | Promise<void>
  selectedFile: {
    path: string
    staged: boolean
    untracked: boolean
    diff: string
    fullDiff: string
  } | null
  loadingDiff: boolean
  discarding: boolean
}

function WorktreeRowDetails({
  details,
  loadingDetails,
  commitMessage,
  setCommitMessage,
  showCommitInput,
  setShowCommitInput,
  handleCommit,
  handleFileClick,
  handleDiscardFile,
  selectedFile,
  loadingDiff,
  discarding,
}: WorktreeRowDetailsProps) {
  return (
    <div className="border-t border-border bg-background/50 px-4 pb-4 pt-3">
      {loadingDetails ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading details…
        </div>
      ) : details ? (
        <div className="space-y-4">
          {showCommitInput && (
            <div className="flex items-start gap-2">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Commit message"
                aria-label="Commit message"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleCommit(false)
                  }
                  if (e.key === 'Escape') setShowCommitInput(false)
                }}
              />
              <button
                type="button"
                onClick={() => handleCommit(false)}
                disabled={!commitMessage.trim()}
                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Commit
              </button>
              <button
                type="button"
                onClick={() => handleCommit(true)}
                disabled={!commitMessage.trim() || details.dirtyFiles.length === 0}
                className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground disabled:opacity-50"
              >
                Commit all
              </button>
            </div>
          )}
          <FileList
            title="Modified"
            icon={<FileX className="h-3.5 w-3.5" />}
            files={details.dirtyFiles}
            color="text-warning"
            onFileClick={handleFileClick}
            onDiscard={handleDiscardFile}
            discarding={discarding}
            selectedFile={selectedFile}
            loadingDiff={loadingDiff}
          />
          <FileList
            title="Staged"
            icon={<FilePlus className="h-3.5 w-3.5" />}
            files={details.stagedFiles}
            color="text-success"
            onFileClick={handleFileClick}
            onDiscard={handleDiscardFile}
            discarding={discarding}
            selectedFile={selectedFile}
            loadingDiff={loadingDiff}
          />
          <FileList
            title="Untracked"
            icon={<FileClock className="h-3.5 w-3.5" />}
            files={details.untrackedFiles}
            color="text-muted"
            onFileClick={handleFileClick}
            onDiscard={handleDiscardFile}
            discarding={discarding}
            selectedFile={selectedFile}
            loadingDiff={loadingDiff}
          />
          <CommitList title="Unpushed commits" commits={details.unpushedCommits} />
          {details.baseBehindCommits.length > 0 && (
            <CommitList
              title={`Not yet integrated from ${details.baseRef ?? details.baseBranch}`}
              commits={details.baseBehindCommits}
            />
          )}
          {details.behindCommits.length > 0 && (
            <CommitList title="Behind this branch's upstream" commits={details.behindCommits} />
          )}
          {details.dirtyFiles.length === 0 &&
            details.stagedFiles.length === 0 &&
            details.untrackedFiles.length === 0 &&
            details.unpushedCommits.length === 0 &&
            details.baseBehindCommits.length === 0 &&
            details.behindCommits.length === 0 && (
              <p className="text-xs text-muted">Nothing to show for this worktree.</p>
            )}
        </div>
      ) : (
        <p className="text-xs text-muted">Could not load details.</p>
      )}
    </div>
  )
}

function FileList({
  title,
  icon,
  files,
  color,
  onFileClick,
  onDiscard,
  discarding,
  selectedFile,
  loadingDiff,
}: {
  title: string
  icon: ReactNode
  files: { path: string; status: string }[]
  color?: string
  onFileClick?: (file: { path: string; status: string }) => void | Promise<void>
  onDiscard?: (file: { path: string; status: string }) => void | Promise<void>
  discarding?: boolean
  selectedFile?: {
    path: string
    diff: string
    fullDiff: string
    staged?: boolean
    untracked?: boolean
  } | null
  loadingDiff?: boolean | undefined
}) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  if (files.length === 0) return null
  const untracked = title === 'Untracked'
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title} ({files.length})
      </h4>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.path}>
            <div className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false)
                  onFileClick?.(f)
                }}
                title={`${f.status} ${f.path}`}
                className={cn(
                  'flex flex-1 items-center gap-2 truncate rounded px-1.5 py-0.5 font-mono text-[11px] text-left',
                  selectedFile?.path === f.path
                    ? 'bg-accent text-foreground'
                    : 'text-foreground/90 hover:bg-accent/50'
                )}
              >
                <span className={cn('shrink-0 font-bold', color)}>{f.status}</span>
                <span className="truncate">{f.path}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDiscard(false)
                  onFileClick?.(f)
                }}
                title="View diff"
                className={cn(
                  'shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100',
                  selectedFile?.path === f.path && 'opacity-100'
                )}
              >
                <Eye className="h-3 w-3" />
              </button>
            </div>
            {selectedFile?.path === f.path && (
              <div className="mt-1 rounded-md border border-border bg-background p-2">
                {loadingDiff ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading diff…
                  </div>
                ) : (
                  <DiffViewer
                    diff={selectedFile.diff}
                    fullDiff={selectedFile.fullDiff}
                    actions={
                      onDiscard ? (
                        confirmDiscard ? (
                          <>
                            <span className="text-[11px] text-muted">
                              {untracked ? 'Delete this new file?' : 'Discard all changes?'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDiscard(false)
                                void onDiscard(f)
                              }}
                              disabled={discarding}
                              className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/25 disabled:opacity-50"
                            >
                              {discarding ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Undo2 className="h-3 w-3" />
                              )}
                              {untracked ? 'Delete' : 'Discard'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDiscard(false)}
                              className="rounded-md px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDiscard(true)}
                            title={
                              untracked ? 'Delete this new file' : 'Discard changes to this file'
                            }
                            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-destructive/15 hover:text-destructive"
                          >
                            <Undo2 className="h-3 w-3" />
                            {untracked ? 'Delete file' : 'Discard changes'}
                          </button>
                        )
                      ) : undefined
                    }
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CommitList({
  title,
  commits,
}: {
  title: string
  commits: { sha: string; subject: string; author: string; date: string }[]
}) {
  if (commits.length === 0) return null
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <GitCommit className="h-3.5 w-3.5" />
        {title} ({commits.length})
      </h4>
      <ul className="space-y-1">
        {commits.map((c) => (
          <li key={c.sha} className="text-[11px]">
            <span className="font-mono text-muted">{c.sha}</span>{' '}
            <span className="text-foreground/90">{c.subject}</span>
            <span className="ml-2 text-muted">
              {c.author} · {new Date(c.date).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One of the project's custom actions. Icon plus label, because a bare icon
 * can't say "dev server" and a bare command doesn't fit; the full command lives
 * in the tooltip.
 */
function ActionButton({
  action,
  subdirectory,
  running,
  disabled,
  onRun,
}: {
  action: ProjectAction
  subdirectory: string | undefined
  running: boolean
  disabled: boolean
  onRun: (action: ProjectAction) => void
}) {
  const Icon = ACTION_ICONS[action.icon]
  const where = subdirectory ? ` in ${subdirectory}/` : ''
  const title = [
    `${action.label} · ${action.command}`,
    action.mode === 'terminal'
      ? `Opens a new terminal window${where}.`
      : `Runs in the background${where}.`,
  ].join('\n\n')

  return (
    <Button
      variant="neutral"
      onClick={() => onRun(action)}
      disabled={disabled || running}
      loading={running}
      title={title}
      className="max-w-[150px]"
    >
      {running ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      <span className="truncate">{action.label}</span>
    </Button>
  )
}
