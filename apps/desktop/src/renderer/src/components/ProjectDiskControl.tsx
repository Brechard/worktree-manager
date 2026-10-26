import { useState } from 'react'
import { HardDrive, RefreshCw } from 'lucide-react'
import type { Repository, Worktree, WorktreeDiskUsage } from '@worktree/contracts'
import { formatBytes } from '@worktree/contracts'
import type { ProjectDiskSummary } from '../lib/projectDisk'
import { Button } from './ui/Button'
import { ProjectDiskDialog } from './ProjectDiskDialog'

interface ProjectDiskControlProps {
  repository: Repository
  worktrees: Worktree[]
  diskUsage: Record<string, WorktreeDiskUsage>
  measuringIds: Set<string>
  summary: ProjectDiskSummary
  onRefresh: () => void
  onReclaim: (worktree: Worktree) => void
}

export function ProjectDiskControl({
  repository,
  worktrees,
  diskUsage,
  measuringIds,
  summary,
  onRefresh,
  onReclaim,
}: ProjectDiskControlProps) {
  const [open, setOpen] = useState(false)
  if (summary.worktreeCount === 0) return null
  const partial = summary.measuredCount < summary.worktreeCount
  const unmeasured = summary.worktreeCount - summary.measuredCount - summary.errorCount
  return (
    <>
      <div className="group relative shrink-0">
        <Button
          variant="neutral"
          onClick={() => setOpen(true)}
          aria-label={`Review disk usage for ${repository.name}`}
          aria-describedby="project-disk-tooltip"
        >
          {summary.measuring ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted" />
          ) : (
            <HardDrive className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="font-medium">Disk usage</span>
          <span>
            ·{' '}
            {summary.measuredCount === 0
              ? summary.measuring
                ? 'Measuring…'
                : unmeasured > 0
                  ? 'Not measured'
                  : 'Size unavailable'
              : `${formatBytes(summary.totalBytes)}${partial ? '+' : ''}`}
          </span>
          {summary.reclaimableBytes > 0 && (
            <span className="text-primary">
              · {formatBytes(summary.reclaimableBytes)} generated
            </span>
          )}
          {summary.errorCount > 0 && (
            <span className="text-warning">· {summary.errorCount} unavailable</span>
          )}
        </Button>
        <span
          id="project-disk-tooltip"
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-72 rounded-lg border border-border bg-card p-3 text-xs leading-relaxed text-foreground shadow-lg group-hover:block group-focus-within:block"
        >
          View disk usage by worktree. Generated files are included in the total.
        </span>
      </div>
      {open && (
        <ProjectDiskDialog
          repository={repository}
          worktrees={worktrees}
          diskUsage={diskUsage}
          measuringIds={measuringIds}
          summary={summary}
          onRefresh={onRefresh}
          onReclaim={(worktree) => {
            setOpen(false)
            onReclaim(worktree)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
