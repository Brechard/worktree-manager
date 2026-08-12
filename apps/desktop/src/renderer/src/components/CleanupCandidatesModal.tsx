import { useState } from 'react'
import { AlertTriangle, CheckSquare, GitBranch, HardDrive, Square, Trash2, X } from 'lucide-react'
import type { CleanupCandidate, Worktree, WorktreeDiskUsage } from '@worktree/contracts'
import { formatBytes } from '@worktree/contracts'
import { shortenPath } from '../lib/paths'

interface CleanupCandidatesModalProps {
  repositoryName: string
  baseBranch: string
  candidates: CleanupCandidate[]
  diskUsage: Record<string, WorktreeDiskUsage>
  /** Worktrees still being measured, so a missing size reads as "counting". */
  measuringIds: Set<string>
  onCancel: () => void
  onConfirm: (selected: Worktree[], permanent: boolean) => void
}

/**
 * The bulk "these branches landed, the worktrees can go" prompt.
 *
 * Two groups, deliberately: the clean ones start checked because removing them
 * is the whole point, while the merged-but-dirty ones start unchecked with
 * their reasons spelled out. Those used to be filtered out entirely, which is
 * how a worktree whose PR merged six months ago keeps 600 MB of dependencies
 * alive forever — nothing ever mentions it again.
 *
 * Sizes are the reason to act, so they are on every row and on the button.
 */
export function CleanupCandidatesModal({
  repositoryName,
  baseBranch,
  candidates,
  diskUsage,
  measuringIds,
  onCancel,
  onConfirm,
}: CleanupCandidatesModalProps) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.kind === 'ready').map((c) => c.worktree.id))
  )

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = checked.size === candidates.length
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(candidates.map((c) => c.worktree.id)))

  const selected = candidates.filter((c) => checked.has(c.worktree.id))
  // Disk cleanup is permanent because Trash does not reclaim bytes. It is opt-in
  // here rather than inferred from the selected sizes: a user can still choose
  // recovery over immediate free space.
  const [permanent, setPermanent] = useState(false)
  const selectedBytes = selected.reduce(
    (sum, c) => sum + (diskUsage[c.worktree.id]?.totalBytes ?? 0),
    0
  )
  const groups = [
    {
      key: 'ready' as const,
      label: 'Merged, clean and pushed',
      items: candidates.filter((c) => c.kind === 'ready'),
    },
    {
      key: 'review' as const,
      label: 'Merged, but something is still in the working tree',
      items: candidates.filter((c) => c.kind === 'review'),
    },
  ].filter((group) => group.items.length > 0)
  // The heading is what explains why a row starts unchecked, so it stays even
  // when the review group is the only one — which is the common case for the
  // worktrees that have been sitting around longest.
  const showGroupLabels = groups.length > 1 || groups[0]?.key === 'review'

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div className="pointer-events-auto flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">Merged worktrees ready to remove</h2>
              <p className="text-xs text-muted">
                {repositoryName} · already merged into {baseBranch}
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="text-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            <button
              type="button"
              onClick={toggleAll}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium text-muted hover:bg-accent hover:text-foreground"
            >
              {allChecked ? (
                <CheckSquare className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {allChecked ? 'Unselect all' : 'Select all'}
            </button>

            {groups.map((group) => (
              <section key={group.key} className="mb-1">
                {showGroupLabels && (
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {group.label}
                  </p>
                )}
                <ul className="space-y-0.5 px-1 pb-1">
                  {group.items.map(({ worktree, branch, reasons }) => {
                    const isChecked = checked.has(worktree.id)
                    const usage = diskUsage[worktree.id]
                    return (
                      <li key={worktree.id}>
                        <button
                          type="button"
                          onClick={() => toggle(worktree.id)}
                          className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent"
                        >
                          {isChecked ? (
                            <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          ) : (
                            <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted" />
                              <span className="truncate">{branch}</span>
                              <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-muted">
                                {usage
                                  ? formatBytes(usage.totalBytes)
                                  : measuringIds.has(worktree.id)
                                    ? 'measuring…'
                                    : ''}
                              </span>
                            </span>
                            <span className="block truncate pl-5 text-xs text-muted">
                              {shortenPath(worktree.path)}
                            </span>
                            {reasons.length > 0 && (
                              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-[11px] text-warning">
                                {reasons.map((reason) => (
                                  <span key={reason} className="inline-flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    {reason}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="shrink-0 border-t border-border px-5 py-4">
            <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md bg-accent/40 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={permanent}
                onChange={(event) => setPermanent(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Free the space immediately</span>
                <span className="mt-0.5 block text-muted">
                  Delete permanently instead of moving to Trash. Leave this off if you want the
                  worktrees to remain recoverable.
                </span>
              </span>
            </label>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground"
              >
                Not now
              </button>
              <div className="flex items-center gap-3">
                {selectedBytes > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <HardDrive className="h-3.5 w-3.5" />
                    {permanent ? 'reclaims up to' : 'to Trash'} {formatBytes(selectedBytes)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onConfirm(selected.map((c) => c.worktree), permanent)}
                  disabled={selected.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:cursor-default disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {permanent ? 'Delete' : 'Remove'} {selected.length} worktree
                  {selected.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
