import { AlertTriangle, CheckCircle2, Cloud, RefreshCw } from 'lucide-react'
import type { RepositoryBaseStatus } from '@worktree/contracts'
import { cn } from '../lib/utils'

interface BaseBranchStatusProps {
  status: RepositoryBaseStatus | undefined
  busy?: boolean
  onRefresh: () => void | Promise<void>
  onUpdate?: () => void | Promise<void>
}

function statusCopy(status: RepositoryBaseStatus): string {
  switch (status.state) {
    case 'current':
      return `${status.baseBranch} up to date`
    case 'behind':
      return `${status.baseBranch} behind origin by ${status.behind}`
    case 'ahead':
      return `${status.baseBranch} ahead of origin by ${status.ahead}`
    case 'diverged':
      return `${status.baseBranch} diverged from origin`
    case 'local-only':
      return `${status.baseBranch} has no origin ref`
    case 'remote-only':
      return `Using origin/${status.baseBranch}`
    case 'unknown':
      return `Could not refresh ${status.baseBranch}`
  }
}

export function BaseBranchStatus({
  status,
  busy = false,
  onRefresh,
  onUpdate,
}: BaseBranchStatusProps) {
  if (!status) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted">
        <Cloud className="h-3.5 w-3.5" />
        Checking base…
      </div>
    )
  }

  const healthy = status.state === 'current'
  const uncertain = status.state === 'unknown' || Boolean(status.fetchError)
  const title = [
    status.fetchError,
    status.fetchedAt ? `Fetched ${new Date(status.fetchedAt).toLocaleString()}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
        healthy
          ? 'border-success/30 bg-success/5 text-success'
          : uncertain
            ? 'border-warning/30 bg-warning/5 text-warning'
            : 'border-warning/30 bg-warning/5 text-warning'
      )}
      title={title || undefined}
    >
      {healthy ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      ) : uncertain ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Cloud className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{statusCopy(status)}</span>
      {status.state === 'behind' && onUpdate && (
        <button
          type="button"
          onClick={() => void onUpdate()}
          disabled={busy}
          className="rounded px-1.5 py-0.5 font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
        >
          Update
        </button>
      )}
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={busy}
        className="rounded p-0.5 text-current/70 hover:bg-black/5 hover:text-current disabled:opacity-50"
        title="Fetch the latest base-branch ref"
        aria-label="Fetch the latest base-branch ref"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
      </button>
    </div>
  )
}
