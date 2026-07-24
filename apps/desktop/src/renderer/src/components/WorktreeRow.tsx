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
  Download,
  Upload,
  RefreshCw,
  FileDiff,
} from 'lucide-react'
import type { Repository, Worktree, WorktreeStatus, WorktreeDetails } from '@worktree/contracts'
import { cn } from '../lib/utils'
import { editorLabel, shortenPath } from '../lib/paths'
import { api } from '../api'

interface WorktreeRowProps {
  worktree: Worktree
  repository: Repository
  status?: WorktreeStatus | undefined
  editorId: string
  onDelete: (path: string) => void
  onActionError?: (message: string) => void
  onRefresh?: () => void
}

export function WorktreeRow({
  worktree,
  repository,
  status,
  editorId,
  onDelete,
  onActionError,
  onRefresh,
}: WorktreeRowProps) {
  const [busy, setBusy] = useState<'editor' | 'terminal' | 'folder' | 'pull' | 'rebase' | 'push' | 'commit' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<WorktreeDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean; untracked: boolean } | null>(null)
  const [fileDiff, setFileDiff] = useState<string>('')
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [showCommitInput, setShowCommitInput] = useState(false)

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

  const gitActions = new Set(['pull', 'rebase', 'push', 'commit'])
  const run = async (
    kind: 'editor' | 'terminal' | 'folder' | 'pull' | 'rebase' | 'push' | 'commit',
    fn: () => Promise<{ success?: boolean; error?: string; output?: string } | string | void>
  ) => {
    setBusy(kind)
    try {
      const result = await fn()
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        onActionError?.(result.error || result.output || `${kind} failed`)
      } else if (typeof result === 'string' && result.length > 0) {
        onActionError?.(result)
      } else if (gitActions.has(kind)) {
        onRefresh?.()
        if (expanded) {
          setDetails(null)
          setSelectedFile(null)
          api.getWorktreeDetails({ worktree, repository }).then(setDetails).catch((err) => onActionError?.(String(err)))
        }
      }
    } catch (err) {
      onActionError?.(String(err))
    } finally {
      setBusy(null)
    }
  }

  const handleOpen = () =>
    run('editor', () => window.api.openInEditor({ path: worktree.path, editor: editorId }))

  const handleTerminal = () =>
    run('terminal', () => window.api.openInTerminal({ path: worktree.path }))

  const handleFolder = () =>
    run('folder', () => window.api.openInFileManager(worktree.path))

  const handlePr = async () => {
    if (status?.pullRequest?.url) {
      await window.api.openExternal(status.pullRequest.url)
    }
  }

  const handlePull = () => run('pull', () => window.api.pullWorktree(worktree.path))
  const handleRebase = () => run('rebase', () => window.api.rebaseWorktree(worktree.path))
  const handlePush = () => run('push', () => window.api.pushWorktree(worktree.path))

  const handleCommit = (all = false) => {
    if (!commitMessage.trim()) return
    run('commit', () => window.api.commitWorktree({ path: worktree.path, message: commitMessage, all }))
    setCommitMessage('')
    setShowCommitInput(false)
  }

  const handleFileClick = async (file: { path: string; status: string }) => {
    const staged = details?.stagedFiles.some((f) => f.path === file.path) ?? false
    const untracked = details?.untrackedFiles.some((f) => f.path === file.path) ?? false
    if (selectedFile?.path === file.path) {
      setSelectedFile(null)
      setFileDiff('')
      return
    }
    setSelectedFile({ path: file.path, staged, untracked })
    setLoadingDiff(true)
    try {
      const diff = await api.getFileDiff({ path: worktree.path, filePath: file.path, staged, untracked })
      setFileDiff(diff)
    } catch (err) {
      onActionError?.(String(err))
      setFileDiff('')
    } finally {
      setLoadingDiff(false)
    }
  }

  const safe =
    !status ||
    (!status.dirty &&
      !status.staged &&
      status.ahead === 0 &&
      status.unpushed === 0 &&
      status.mergedIntoBase &&
      !status.hasOpenPR)

  return (
    <div className="border-b border-border last:border-b-0 hover:bg-row-hover">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer text-left"
          title="Click for details"
        >
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-foreground">
              {expanded ? (
                <ChevronDown className="h-3 w-3 text-primary" />
              ) : (
                <ChevronRight className="h-3 w-3 text-primary" />
              )}
              <GitBranch className="h-3 w-3 text-primary" />
              {worktree.branch}
            </span>
            {worktree.isMain && (
              <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                Primary
              </span>
            )}
            {status?.pullRequest && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handlePr()
                }}
                className={cn(
                  'inline-flex max-w-[220px] items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-medium',
                  status.pullRequest.state === 'open' && 'bg-success/15 text-success',
                  status.pullRequest.state === 'draft' && 'bg-muted/20 text-muted',
                  status.pullRequest.state === 'closed' && 'bg-muted/20 text-muted',
                  status.pullRequest.state === 'merged' && 'bg-primary/15 text-primary'
                )}
                title={status.pullRequest.title}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {status.pullRequest.state === 'merged' ? 'merged' : status.pullRequest.state} · {status.pullRequest.title}
                </span>
              </button>
            )}
            {!safe && !worktree.isMain && (
              <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                not safe to delete
              </span>
            )}
          </div>

          <p className="truncate font-mono text-[12px] text-muted" title={worktree.path}>
            {shortenPath(worktree.path)}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {worktree.headCommit && (
              <span className="inline-flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                {worktree.headCommit}
              </span>
            )}
            {worktree.lastModified && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(worktree.lastModified).toLocaleDateString()}
              </span>
            )}
            {status && (
              <>
                {status.dirty && <span className="text-warning">dirty</span>}
                {status.staged && <span className="text-warning">staged</span>}
                {(status.ahead > 0 || status.unpushed > 0) && (
                  <span className="text-warning">
                    {status.ahead > 0 ? `${status.ahead} ahead` : `${status.unpushed} unpushed`}
                  </span>
                )}
                {status.behind > 0 && <span>{status.behind} behind</span>}
                {!status.mergedIntoBase && worktree.branch !== status.baseBranch && (
                  <span className="text-warning">unmerged</span>
                )}
                {status.mergedIntoBase && !worktree.isMain && (
                  <span className="text-success">merged</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <ActionButton
            title="Pull fast-forward"
            onClick={handlePull}
            busy={busy === 'pull'}
            icon={<Download className="h-3 w-3" />}
            label="Pull"
            variant="secondary"
          />
          <ActionButton
            title="Pull with rebase"
            onClick={handleRebase}
            busy={busy === 'rebase'}
            icon={<RefreshCw className="h-3 w-3" />}
            label="Rebase"
            variant="secondary"
          />
          <ActionButton
            title="Push branch"
            onClick={handlePush}
            busy={busy === 'push'}
            icon={<Upload className="h-3 w-3" />}
            label="Push"
            variant="secondary"
          />
          <ActionButton
            title={showCommitInput ? 'Hide commit input' : 'Commit staged changes'}
            onClick={() => setShowCommitInput((v) => !v)}
            busy={busy === 'commit'}
            icon={<GitCommit className="h-3 w-3" />}
            label="Commit"
            variant={showCommitInput ? 'primary' : 'secondary'}
          />
          <IconButton
            title={`Open in ${editorLabel(editorId)}`}
            onClick={handleOpen}
            busy={busy === 'editor'}
          >
            <Code2 className="h-4 w-4" />
          </IconButton>
          <IconButton title="Open in terminal" onClick={handleTerminal} busy={busy === 'terminal'}>
            <Terminal className="h-4 w-4" />
          </IconButton>
          <IconButton title="Reveal in Finder" onClick={handleFolder} busy={busy === 'folder'}>
            <FolderOpen className="h-4 w-4" />
          </IconButton>
          {!worktree.isMain && (
            <IconButton title="Move to Trash" onClick={() => onDelete(worktree.path)} danger>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      {expanded && (
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
                    onClick={() => handleCommit(false)}
                    disabled={!commitMessage.trim()}
                    className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Commit
                  </button>
                  <button
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
                selectedPath={selectedFile?.path}
                fileDiff={selectedFile ? fileDiff : ''}
                loadingDiff={loadingDiff}
              />
              <FileList
                title="Staged"
                icon={<FilePlus className="h-3.5 w-3.5" />}
                files={details.stagedFiles}
                color="text-success"
                onFileClick={handleFileClick}
                selectedPath={selectedFile?.path}
                fileDiff={selectedFile ? fileDiff : ''}
                loadingDiff={loadingDiff}
              />
              <FileList
                title="Untracked"
                icon={<FileClock className="h-3.5 w-3.5" />}
                files={details.untrackedFiles}
                color="text-muted"
                onFileClick={handleFileClick}
                selectedPath={selectedFile?.path}
                fileDiff={selectedFile ? fileDiff : ''}
                loadingDiff={loadingDiff}
              />
              <CommitList title="Unpushed commits" commits={details.unpushedCommits} />
              {details.behindCommits.length > 0 && (
                <CommitList title={`Behind ${details.baseBranch}`} commits={details.behindCommits} />
              )}
              {details.dirtyFiles.length === 0 &&
                details.stagedFiles.length === 0 &&
                details.untrackedFiles.length === 0 &&
                details.unpushedCommits.length === 0 &&
                details.behindCommits.length === 0 && (
                  <p className="text-xs text-muted">Nothing to show for this worktree.</p>
                )}
            </div>
          ) : (
            <p className="text-xs text-muted">Could not load details.</p>
          )}
        </div>
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
  selectedPath,
  fileDiff,
  loadingDiff,
}: {
  title: string
  icon: ReactNode
  files: { path: string; status: string }[]
  color?: string
  onFileClick?: (file: { path: string; status: string }) => void | Promise<void>
  selectedPath?: string | undefined
  fileDiff?: string | undefined
  loadingDiff?: boolean | undefined
}) {
  if (files.length === 0) return null
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title} ({files.length})
      </h4>
      <ul className="space-y-0.5">
        {files.map((f, i) => (
          <li key={`${f.path}-${i}`}>
            <div className="group flex items-center gap-1">
              <button
                onClick={() => onFileClick?.(f)}
                title={`${f.status} ${f.path}`}
                className={cn(
                  'flex flex-1 items-center gap-2 truncate rounded px-1.5 py-0.5 font-mono text-[11px] text-left',
                  selectedPath === f.path ? 'bg-accent text-foreground' : 'text-foreground/90 hover:bg-accent/50'
                )}
              >
                <span className={cn('shrink-0 font-bold', color)}>{f.status}</span>
                <span className="truncate">{f.path}</span>
              </button>
              <button
                onClick={() => onFileClick?.(f)}
                title="View diff"
                className={cn(
                  'shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100',
                  selectedPath === f.path && 'opacity-100'
                )}
              >
                <FileDiff className="h-3 w-3" />
              </button>
            </div>
            {selectedPath === f.path && (
              <div className="mt-1 rounded-md border border-border bg-background p-2">
                {loadingDiff ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading diff…
                  </div>
                ) : fileDiff ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
                    {fileDiff}
                  </pre>
                ) : (
                  <p className="text-[10px] text-muted">No diff available.</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  title,
  onClick,
  busy,
  variant = 'secondary',
}: {
  icon: ReactNode
  label: string
  title: string
  onClick: () => void
  busy?: boolean
  variant?: 'primary' | 'secondary'
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted/60 text-foreground hover:bg-accent'
      )}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
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
