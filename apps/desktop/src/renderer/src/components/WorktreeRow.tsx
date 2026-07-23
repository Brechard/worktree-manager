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
}

export function WorktreeRow({
  worktree,
  repository,
  status,
  editorId,
  onDelete,
  onActionError,
}: WorktreeRowProps) {
  const [busy, setBusy] = useState<'editor' | 'terminal' | 'folder' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [details, setDetails] = useState<WorktreeDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

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
    kind: 'editor' | 'terminal' | 'folder',
    fn: () => Promise<{ success?: boolean; error?: string } | string | void>
  ) => {
    setBusy(kind)
    try {
      const result = await fn()
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        onActionError?.(result.error || `Failed to open ${kind}`)
      } else if (typeof result === 'string' && result.length > 0) {
        onActionError?.(result)
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

        <div className="flex shrink-0 items-center gap-0.5">
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
              <FileList title="Modified" icon={<FileX className="h-3.5 w-3.5" />} files={details.dirtyFiles} color="text-warning" />
              <FileList title="Staged" icon={<FilePlus className="h-3.5 w-3.5" />} files={details.stagedFiles} color="text-success" />
              <FileList title="Untracked" icon={<FileClock className="h-3.5 w-3.5" />} files={details.untrackedFiles} color="text-muted" />
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
}: {
  title: string
  icon: ReactNode
  files: { path: string; status: string }[]
  color?: string
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
          <li
            key={`${f.path}-${i}`}
            className="flex items-center gap-2 truncate font-mono text-[11px]"
            title={`${f.status} ${f.path}`}
          >
            <span className={cn('shrink-0 font-bold', color)}>{f.status}</span>
            <span className="truncate text-foreground/90">{f.path}</span>
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
