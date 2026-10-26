import { HardDrive, RefreshCw, X } from 'lucide-react'
import type { Repository, Worktree, WorktreeDiskUsage } from '@worktree/contracts'
import { formatBytes } from '@worktree/contracts'
import { shortenPath } from '../lib/paths'
import type { ProjectDiskSummary } from '../lib/projectDisk'
import { Dialog } from './ui/Dialog'
import { Button, IconButton } from './ui/Button'

interface ProjectDiskDialogProps {
  repository: Repository
  worktrees: Worktree[]
  diskUsage: Record<string, WorktreeDiskUsage>
  measuringIds: Set<string>
  summary: ProjectDiskSummary
  onRefresh: () => void
  onReclaim: (worktree: Worktree) => void
  onClose: () => void
}

function summaryLabels(summary: ProjectDiskSummary): { total: string; generated: string } {
  const partial = summary.measuredCount < summary.worktreeCount
  const unmeasured = summary.worktreeCount - summary.measuredCount - summary.errorCount
  if (summary.measuredCount > 0) {
    const suffix = partial ? '+' : ''
    return {
      total: `${formatBytes(summary.totalBytes)}${suffix} estimated on disk`,
      generated: `Of this, ${formatBytes(summary.reclaimableBytes)}${suffix} is generated`,
    }
  }
  if (summary.measuring)
    return { total: 'No sizes measured yet', generated: 'Generated size pending' }
  if (unmeasured > 0) return { total: 'Not measured yet', generated: 'Generated size not measured' }
  return { total: 'Sizes unavailable', generated: 'Generated size unavailable' }
}

function worktreeSizeLabel(usage: WorktreeDiskUsage | undefined, busy: boolean): string {
  if (usage && !usage.error) return `${formatBytes(usage.totalBytes)} estimated`
  if (busy) return 'Measuring…'
  return usage ? 'Unavailable' : 'Not measured'
}

function GeneratedDetails({
  worktree,
  usage,
  busy,
  onReclaim,
}: {
  worktree: Worktree
  usage: WorktreeDiskUsage
  busy: boolean
  onReclaim: (worktree: Worktree) => void
}) {
  return (
    <>
      {usage.entries.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {usage.entries.map((entry) => (
            <li key={entry.path} className="flex min-w-0 justify-between gap-3 text-xs text-muted">
              <span className="min-w-0 truncate" title={entry.path}>
                {entry.path} <span className="opacity-75">({entry.kind})</span>
              </span>
              <span className="shrink-0">{formatBytes(entry.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {usage.reclaimableBytes === 0 && (
        <p className="mt-2 text-xs text-muted">No generated directories identified for removal.</p>
      )}
      {usage.reclaimableBytes > 0 && !busy && (
        <div className="mt-3 border-t border-border pt-2">
          <Button variant="softWarning" size="compact" onClick={() => onReclaim(worktree)}>
            Review generated-file cleanup
          </Button>
        </div>
      )}
    </>
  )
}

function DiskWorktreeItem({
  worktree,
  usage,
  busy,
  onReclaim,
}: {
  worktree: Worktree
  usage: WorktreeDiskUsage | undefined
  busy: boolean
  onReclaim: (worktree: Worktree) => void
}) {
  const valid = usage && !usage.error
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="truncate">
              {worktree.branch}
              {worktree.isMain ? ' · primary' : ''}
            </span>
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={worktree.path}>
            {shortenPath(worktree.path)}
          </p>
        </div>
        <p className="shrink-0 text-right text-xs font-medium">
          {worktreeSizeLabel(usage, busy)}
          {valid && usage.reclaimableBytes > 0 && (
            <span className="block font-normal text-primary">
              {formatBytes(usage.reclaimableBytes)} generated
            </span>
          )}
        </p>
      </div>
      {usage?.error && (
        <p className="mt-2 text-xs text-warning">Could not measure: {usage.error}</p>
      )}
      {valid && (
        <GeneratedDetails worktree={worktree} usage={usage} busy={busy} onReclaim={onReclaim} />
      )}
    </li>
  )
}

export function ProjectDiskDialog({
  repository,
  worktrees,
  diskUsage,
  measuringIds,
  summary,
  onRefresh,
  onReclaim,
  onClose,
}: ProjectDiskDialogProps) {
  const labels = summaryLabels(summary)
  return (
    <Dialog
      titleId="project-disk-title"
      onClose={onClose}
      size="wide"
      initialFocus="[data-disk-close]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 id="project-disk-title" className="text-base font-semibold">
            Disk usage · {repository.name}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Review measured space by worktree. Nothing is removed from this screen.
          </p>
        </div>
        <IconButton data-disk-close variant="quiet" aria-label="Close disk usage" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="max-h-[min(65vh,470px)] overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
          <div>
            <p className="text-sm font-semibold">{labels.total}</p>
            <p className="mt-0.5 text-xs text-muted">
              {labels.generated} · {summary.measuredCount} of {summary.worktreeCount} worktrees
              measured
            </p>
          </div>
          <Button variant="neutral" size="compact" onClick={onRefresh} disabled={summary.measuring}>
            <RefreshCw className={`h-3.5 w-3.5 ${summary.measuring ? 'animate-spin' : ''}`} />
            {summary.measuring ? 'Measuring…' : 'Refresh sizes'}
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Generated means ignored dependency, build, cache, or test directories identified for
          review. Sizes are allocated-space estimates; shared disk blocks may reduce the space
          actually freed. Each removal checks the paths again and requires confirmation.
        </p>
        {summary.errorCount > 0 && (
          <p role="status" className="mt-3 text-xs text-warning">
            {summary.errorCount} worktree{summary.errorCount === 1 ? '' : 's'} could not be
            measured. Refresh sizes to retry.
          </p>
        )}
        {worktrees.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            This project has no worktrees to measure.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {worktrees.map((worktree) => (
              <DiskWorktreeItem
                key={worktree.id}
                worktree={worktree}
                usage={diskUsage[worktree.id]}
                busy={measuringIds.has(worktree.id)}
                onReclaim={onReclaim}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
