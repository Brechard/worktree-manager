import { useEffect, useState, type ReactNode } from 'react'
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
} from 'lucide-react'
import type {
  Repository,
  SyncBaseMode,
  Worktree,
  WorktreeStatus,
  WorktreeDetails,
} from '@worktree/contracts'
import { branchCanHavePullRequest, recommendedSyncMode } from '@worktree/contracts'
import { cn } from '../lib/utils'
import { editorLabel, shortenPath } from '../lib/paths'
import { api } from '../api'
import { GitActionsMenu, type MergeMode } from './GitActionsMenu'
import { SyncBaseButton } from './SyncBaseButton'
import { DiffViewer } from './DiffViewer'
import { isSafeToDelete } from '../lib/worktreeSorting'

type BusyKind =
  | 'editor'
  | 'terminal'
  | 'folder'
  | 'pull'
  | 'rebase'
  | 'push'
  | 'commit'
  | 'updateBase'
  | 'checkout'
  | 'merge'
  | 'sync'

interface WorktreeRowProps {
  worktree: Worktree
  repository: Repository
  status?: WorktreeStatus | undefined
  /** A targeted re-sync of this row is in flight (git + PR lookup). */
  refreshing?: boolean | undefined
  editorId: string
  onDelete: (worktree: Worktree) => void
  onActionError?: ((message: string) => void) | undefined
  onRefresh?: (() => void) | undefined
  onRefreshWorktree?: ((worktree: Worktree) => Promise<void> | void) | undefined
  onBranchChange?: ((worktreeId: string, branch: string) => void) | undefined
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

export function WorktreeRow(props: WorktreeRowProps) {
  const { worktree, repository, status, refreshing, editorId, onDelete, onActionError, onRefresh, onRefreshWorktree, onBranchChange } = props

  const [busy, setBusy] = useState<BusyKind | null>(null)
  const [expanded, setExpanded] = useState(false)
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
  const [commitMessage, setCommitMessage] = useState('')
  const [showCommitInput, setShowCommitInput] = useState(false)
  // Set when a sync came back saying the other mode is the one that works, so
  // the next click runs that instead of walking into the same conflict again.
  const [learnedMode, setLearnedMode] = useState<SyncBaseMode | null>(null)

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

  const run = async (
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
          api
            .getWorktreeDetails({ worktree, repository })
            .then(setDetails)
            .catch((err) => onActionError?.(String(err)))
        }
      }
    } catch (err) {
      onActionError?.(String(err))
      if (gitActions.has(kind)) reconcile()
    } finally {
      setBusy(null)
    }
  }

  const handleOpen = () =>
    run('editor', () => window.api.openInEditor({ path: worktree.path, editor: editorId }))

  const handleTerminal = () =>
    run('terminal', () => window.api.openInTerminal({ path: worktree.path }))

  const handleFolder = () => run('folder', () => window.api.openInFileManager(worktree.path))

  const handlePr = async () => {
    if (status?.pullRequest?.url) {
      await window.api.openExternal(status.pullRequest.url)
    }
  }

  const handlePull = () => run('pull', () => window.api.pullWorktree(worktree.path))
  const handleRebase = () => run('rebase', () => window.api.rebaseWorktree(worktree.path))
  const handlePush = () => run('push', () => window.api.pushWorktree(worktree.path))
  const handleUpdateBaseBranch = () =>
    run('updateBase', () =>
      window.api.updateBaseBranch({ path: worktree.path, baseBranch: repository.baseBranch })
    )

  // Unlike the other git actions, a sync reports back even when it succeeds:
  // "already up to date" and "the rebase landed but your stash needs a hand" are
  // both outcomes the user has to see, not silent no-ops.
  const handleSync = (mode: SyncBaseMode) =>
    run('sync', async () => {
      const result = await window.api.syncWithBase({
        path: worktree.path,
        baseBranch: repository.baseBranch,
        mode,
      })
      setLearnedMode(result.recommendedMode ?? null)
      if (!result.success) return { success: false, output: result.output }
      if (result.outcome !== 'synced') onActionError?.(result.output)
      return undefined
    })

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

  // A learned mode only answers "what works against *this* base, from *this*
  // commit". Once either moves the answer may differ, so drop it and let the
  // branch's own shape decide again.
  const syncSignature = `${status?.baseRef ?? ''}:${status?.behindBase ?? 0}:${status?.headCommit ?? ''}`
  useEffect(() => {
    setLearnedMode(null)
  }, [syncSignature])

  const liveBranch = status?.branch ?? worktree.branch
  const detached = status?.detached ?? liveBranch === 'HEAD'
  const headCommit = status?.headCommit ?? worktree.headCommit
  const prunable = worktree.prunable === true
  const safe = !status || worktree.isMain || worktree.prunable || isSafeToDelete(worktree, status)
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
    <div className="border-b border-border last:border-b-0 hover:bg-row-hover">
      <WorktreeRowHeader
        worktree={worktree}
        status={status}
        repository={repository}
        busy={busy}
        liveBranch={liveBranch}
        detached={detached}
        headCommit={headCommit}
        prunable={prunable}
        safe={safe}
        prTargetBranch={prTargetBranch}
        mergedIntoOtherBranch={mergedIntoOtherBranch}
        prPending={prPending}
        expanded={expanded}
        setExpanded={setExpanded}
        editorId={editorId}
        showCommitInput={showCommitInput}
        setShowCommitInput={setShowCommitInput}
        onDelete={onDelete}
        handleOpen={handleOpen}
        handleTerminal={handleTerminal}
        handleFolder={handleFolder}
        handlePr={handlePr}
        handlePull={handlePull}
        handleRebase={handleRebase}
        handlePush={handlePush}
        handleUpdateBaseBranch={handleUpdateBaseBranch}
        handleCheckout={handleCheckout}
        handleMerge={handleMerge}
        handleSync={handleSync}
        learnedMode={learnedMode}
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

interface WorktreeRowHeaderProps {
  worktree: Worktree
  status?: WorktreeStatus | undefined
  repository: Repository
  busy: BusyKind | null
  liveBranch: string
  detached: boolean
  headCommit: string | undefined
  prunable: boolean
  safe: boolean
  prTargetBranch: string | undefined
  mergedIntoOtherBranch: boolean
  prPending: boolean
  expanded: boolean
  setExpanded: (v: React.SetStateAction<boolean>) => void
  editorId: string
  showCommitInput: boolean
  setShowCommitInput: (v: React.SetStateAction<boolean>) => void
  onDelete: (worktree: Worktree) => void
  handleOpen: () => void
  handleTerminal: () => void
  handleFolder: () => void
  handlePr: () => Promise<void>
  handlePull: () => void
  handleRebase: () => void
  handlePush: () => void
  handleUpdateBaseBranch: () => void
  handleCheckout: (branch: string) => void
  handleMerge: (branch: string, mode: MergeMode) => void
  handleSync: (mode: SyncBaseMode) => void
  /** Mode a previous sync proved to be the working one, if any. */
  learnedMode: SyncBaseMode | null
  handleLoadBranches: () => Promise<string[]>
}

function WorktreeRowHeader({
  worktree,
  status,
  repository,
  busy,
  liveBranch,
  detached,
  headCommit,
  prunable,
  safe,
  prTargetBranch,
  mergedIntoOtherBranch,
  prPending,
  expanded,
  setExpanded,
  editorId,
  showCommitInput,
  setShowCommitInput,
  onDelete,
  handleOpen,
  handleTerminal,
  handleFolder,
  handlePr,
  handlePull,
  handleRebase,
  handlePush,
  handleUpdateBaseBranch,
  handleCheckout,
  handleMerge,
  handleSync,
  learnedMode,
  handleLoadBranches,
}: WorktreeRowHeaderProps) {
  const behindBase = status?.behindBase ?? 0
  const baseRef = status?.baseRef ?? repository.baseBranch
  const canSync = !prunable && !detached && behindBase > 0
  const suggested = recommendedSyncMode(status, baseRef)
  // What a sync actually proved beats what the branch's shape suggests.
  const syncMode = learnedMode ?? suggested.mode
  const syncReason =
    learnedMode && learnedMode !== suggested.mode
      ? `A rebase onto ${baseRef} conflicts here, but a merge applies cleanly.`
      : suggested.reason

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
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
          'min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
          prunable ? 'cursor-default' : 'cursor-pointer'
        )}
        title={prunable ? undefined : 'Click for details'}
      >
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-foreground">
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
          {status?.pullRequest ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handlePr()
              }}
              className={cn(
                'inline-flex max-w-[220px] items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-medium',
                status.pullRequest.state === 'open' && 'bg-success/15 text-success',
                status.pullRequest.state === 'draft' && 'bg-muted/20 text-muted',
                status.pullRequest.state === 'closed' && 'bg-muted/20 text-muted',
                status.pullRequest.state === 'merged' && 'bg-merged/15 text-merged'
              )}
              title={
                mergedIntoOtherBranch
                  ? `${status.pullRequest.title}\n\nMerged into ${prTargetBranch}, not into the configured base ${status.baseBranch}.`
                  : status.pullRequest.title
              }
            >
              {prPending ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <ExternalLink className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">
                {mergedIntoOtherBranch
                  ? `merged into ${prTargetBranch}`
                  : status.pullRequest.state === 'merged'
                    ? 'merged'
                    : status.pullRequest.state}{' '}
                · {status.pullRequest.title}
              </span>
            </button>
          ) : (
            prPending && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-muted"
                title={`Looking up the pull request for ${liveBranch}…`}
              >
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                pull request
              </span>
            )
          )}
          {!safe && !worktree.isMain && !prunable && (
            <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
              not safe to delete
            </span>
          )}
        </div>

        <p className="truncate font-mono text-[12px] text-muted" title={worktree.path}>
          {shortenPath(worktree.path)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
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
          {prunable && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              {worktree.prunableReason || 'Working tree directory is missing'}
            </span>
          )}
          {status && !prunable && (
            <>
              {status.dirty && <span className="text-warning">dirty</span>}
              {status.staged && <span className="text-warning">staged</span>}
              {(status.ahead > 0 || status.unpushed > 0) && (
                <span className="text-warning">
                  {status.ahead > 0 ? `${status.ahead} ahead` : `${status.unpushed} unpushed`}
                </span>
              )}
              {/* On the base branch itself the upstream *is* the base ref, so the
                  count below already says it — don't print the same number twice. */}
              {status.behind > 0 && liveBranch !== status.baseBranch && (
                <span title={`${status.behind} commit(s) on this branch's own upstream`}>
                  {status.behind} behind upstream
                </span>
              )}
              {/* Only when there is no sync button to say it — the button spells
                  out the same count and ref, and printing both reads as noise. */}
              {behindBase > 0 && !canSync && (
                <span
                  className="text-primary"
                  title={`${baseRef} has ${behindBase} commit(s) this branch has not integrated yet.`}
                >
                  {behindBase} behind {baseRef}
                </span>
              )}
              {detached ? (
                <span className="text-muted">detached</span>
              ) : !status.mergedIntoBase && liveBranch !== status.baseBranch ? (
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
              ) : (
                status.mergedIntoBase &&
                !worktree.isMain && <span className="font-medium text-merged">merged</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {prunable ? (
          <button
            type="button"
            onClick={() => onDelete(worktree)}
            title="Remove this stale worktree entry from git"
            className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Prune
          </button>
        ) : (
          <>
            {busy && gitActions.has(busy) && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
                <Loader2 className="h-3 w-3 animate-spin" />
                {gitBusyLabel(busy, repository.baseBranch)}
              </span>
            )}
            {canSync && (
              <SyncBaseButton
                behind={behindBase}
                baseRef={baseRef}
                mode={syncMode}
                reason={syncReason}
                busy={busy === 'sync'}
                disabled={Boolean(busy) && busy !== 'sync'}
                onSync={handleSync}
              />
            )}
            <GitActionsMenu
              busy={busy}
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
              behindBase={behindBase}
              baseRef={baseRef}
              syncMode={syncMode}
              canSync={canSync}
            />
            <IconButton
              title={`Open in ${editorLabel(editorId)}`}
              onClick={handleOpen}
              busy={busy === 'editor'}
            >
              <Code2 className="h-4 w-4" />
            </IconButton>
            <IconButton
              title="Open in terminal"
              onClick={handleTerminal}
              busy={busy === 'terminal'}
            >
              <Terminal className="h-4 w-4" />
            </IconButton>
            <IconButton title="Reveal in Finder" onClick={handleFolder} busy={busy === 'folder'}>
              <FolderOpen className="h-4 w-4" />
            </IconButton>
            {!worktree.isMain && (
              <IconButton title="Move to Trash" onClick={() => onDelete(worktree)} danger>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            )}
          </>
        )}
      </div>
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

function IconButton({
  children,
  title,
  onClick,
  busy,
  danger,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={busy}
      className={cn(
        'rounded-md p-2 text-muted transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50',
        danger && 'hover:bg-destructive/15 hover:text-destructive'
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  )
}
