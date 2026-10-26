import { useState } from 'react'
import { Dialog } from './ui/Dialog'
import { Button, IconButton } from './ui/Button'
import { AlertTriangle, CheckSquare, GitBranch, HardDrive, Square, Trash2, X } from 'lucide-react'
import type {
  CleanupCandidate,
  Repository,
  Worktree,
  WorktreeDetails,
  WorktreeDiskUsage,
} from '@worktree/contracts'
import { formatBytes } from '@worktree/contracts'
import { shortenPath } from '../lib/paths'
import { api } from '../api'

interface CleanupCandidatesModalProps {
  repositoryName: string
  baseBranch: string
  repository: Repository
  manual?: boolean
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
interface CleanupCandidateRowProps {
  candidate: CleanupCandidate
  repository: Repository
  isChecked: boolean
  usage: WorktreeDiskUsage | undefined
  measuring: boolean
  onToggle: () => void
}

function CleanupCandidateRow({
  candidate,
  repository,
  isChecked,
  usage,
  measuring,
  onToggle,
}: CleanupCandidateRowProps) {
  const { worktree, branch, reasons } = candidate
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<WorktreeDetails | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const toggleDetails = () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (detail || detailError) return
    setLoading(true)
    void api
      .getWorktreeDetails({ worktree, repository })
      .then(setDetail)
      .catch((error) => setDetailError(String(error)))
      .finally(() => setLoading(false))
  }
  return (
    <li key={worktree.id}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isChecked}
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
              {usage ? formatBytes(usage.totalBytes) : measuring ? 'measuring…' : ''}
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
                  {reason.replace(
                    /(\d+) unpushed commit\(s\)/,
                    (_, count: string) => `${count} unpushed commit${count === '1' ? '' : 's'}`
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      <div className="pl-8 pr-2 pb-2">
        <button
          type="button"
          onClick={toggleDetails}
          className="text-xs font-medium text-primary hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? 'Hide files and commits' : 'Show files and commits'}
        </button>
        {expanded && (
          <div className="mt-2 max-h-48 overflow-auto rounded-lg bg-accent/40 p-2 font-mono text-[11px] leading-5 text-foreground">
            {loading ? (
              'Loading changed files and commits…'
            ) : detailError ? (
              `Could not inspect details: ${detailError}`
            ) : detail ? (
              <>
                {(
                  [
                    ['Modified', detail.dirtyFiles],
                    ['Staged', detail.stagedFiles],
                    ['Untracked', detail.untrackedFiles],
                  ] as const
                ).map(
                  ([label, files]) =>
                    files.length > 0 && (
                      <div key={label}>
                        <strong>{label}</strong>
                        {files.map((file) => (
                          <div key={file.path} className="break-all pl-2">
                            {file.path}
                          </div>
                        ))}
                      </div>
                    )
                )}
                {detail.unpushedCommits.length > 0 && (
                  <div>
                    <strong>Unpushed commits</strong>
                    {detail.unpushedCommits.map((commit) => (
                      <div key={commit.sha} className="break-words pl-2">
                        {commit.sha.slice(0, 8)} {commit.subject}
                      </div>
                    ))}
                  </div>
                )}
                {detail.dirtyFiles.length +
                  detail.stagedFiles.length +
                  detail.untrackedFiles.length +
                  detail.unpushedCommits.length ===
                  0 && 'No changed files or unpushed commits were reported.'}
              </>
            ) : null}
          </div>
        )}
      </div>
    </li>
  )
}

interface CleanupFooterProps {
  manual: boolean
  selected: CleanupCandidate[]
  selectedBytes: number
  needsAcknowledgement: boolean
  canDeletePermanently: boolean
  permanent: boolean
  setPermanent: (value: boolean) => void
  acknowledged: boolean
  setAcknowledged: (value: boolean) => void
  onCancel: () => void
  onConfirm: (selected: Worktree[], permanent: boolean) => void
}

function CleanupFooter({
  manual,
  selected,
  selectedBytes,
  needsAcknowledgement,
  canDeletePermanently,
  permanent,
  setPermanent,
  acknowledged,
  setAcknowledged,
  onCancel,
  onConfirm,
}: CleanupFooterProps) {
  return (
    <div className="shrink-0 border-t border-border px-5 py-4">
      {selected.length > 0 && (
        <p className="mb-3 text-xs leading-relaxed text-muted">
          {manual
            ? 'Uncommitted and untracked files move to Trash with the worktree. Local branches and their commits are kept.'
            : 'Ready worktrees may also remove their merged local branches. Worktrees needing review keep their branches and move to Trash.'}
        </p>
      )}
      {!manual && (
        <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md bg-accent/40 px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={permanent && canDeletePermanently}
            onChange={(event) => setPermanent(event.target.checked)}
            disabled={!canDeletePermanently}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground">Free the space immediately</span>
            <span className="mt-0.5 block text-muted">
              {canDeletePermanently
                ? 'Delete permanently instead of moving to Trash. Leave this off if you want the worktrees to remain recoverable.'
                : 'Only available when every selected worktree is ready to clean. Rows needing review go to Trash.'}
            </span>
          </span>
        </label>
      )}
      {needsAcknowledgement && (
        <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5"
          />
          <span>I reviewed the selected worktrees and their local changes.</span>
        </label>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button variant="quiet" onClick={onCancel}>
          Not now
        </Button>
        <div className="flex items-center gap-3">
          {selectedBytes > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <HardDrive className="h-3.5 w-3.5" />
              {permanent && canDeletePermanently ? 'reclaims up to' : 'to Trash'}{' '}
              {formatBytes(selectedBytes)}
            </span>
          )}
          <Button
            variant="danger"
            onClick={() =>
              onConfirm(
                selected.map((c) => c.worktree),
                permanent && canDeletePermanently
              )
            }
            disabled={selected.length === 0 || (needsAcknowledgement && !acknowledged)}
          >
            <Trash2 className="h-4 w-4" />
            {permanent && canDeletePermanently ? 'Delete' : 'Remove'} {selected.length} worktree
            {selected.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function CleanupCandidatesModal({
  repositoryName,
  baseBranch,
  repository,
  manual = false,
  candidates,
  diskUsage,
  measuringIds,
  onCancel,
  onConfirm,
}: CleanupCandidatesModalProps) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => manual || c.kind === 'ready').map((c) => c.worktree.id))
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const toggle = (id: string) => {
    setAcknowledged(false)
    setPermanent(false)
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked = checked.size === candidates.length
  const toggleAll = () => {
    setAcknowledged(false)
    setPermanent(false)
    setChecked(allChecked ? new Set() : new Set(candidates.map((c) => c.worktree.id)))
  }

  const selected = candidates.filter((c) => checked.has(c.worktree.id))
  const needsAcknowledgement = selected.some((c) => c.kind === 'review' || c.reasons.length > 0)
  const canDeletePermanently = !manual && !needsAcknowledgement
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
      label: 'Ready to clean',
      items: candidates.filter((c) => c.kind === 'ready'),
    },
    {
      key: 'review' as const,
      label: manual ? 'Review before removing' : 'Landed with changes to review',
      items: candidates.filter((c) => c.kind === 'review'),
    },
  ].filter((group) => group.items.length > 0)
  // The heading is what explains why a row starts unchecked, so it stays even
  // when the review group is the only one — which is the common case for the
  // worktrees that have been sitting around longest.
  const showGroupLabels = groups.length > 1 || groups[0]?.key === 'review'

  return (
    <Dialog titleId="cleanup-title" onClose={onCancel} initialFocus="button[aria-pressed]">
      <div className="flex max-h-[85vh] flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="cleanup-title" className="text-base font-semibold">
              Review worktrees to remove
            </h2>
            <p className="text-xs text-muted">
              {repositoryName} ·{' '}
              {manual
                ? 'selected visible worktrees · branches stay'
                : `cleanup candidates for ${baseBranch}`}
            </p>
          </div>
          <IconButton onClick={onCancel} variant="quiet" aria-label="Close cleanup review">
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          <button
            type="button"
            onClick={toggleAll}
            aria-pressed={allChecked}
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
                {group.items.map((candidate) => (
                  <CleanupCandidateRow
                    key={candidate.worktree.id}
                    candidate={candidate}
                    repository={repository}
                    isChecked={checked.has(candidate.worktree.id)}
                    usage={diskUsage[candidate.worktree.id]}
                    measuring={measuringIds.has(candidate.worktree.id)}
                    onToggle={() => toggle(candidate.worktree.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <CleanupFooter
          manual={manual}
          selected={selected}
          selectedBytes={selectedBytes}
          needsAcknowledgement={needsAcknowledgement}
          canDeletePermanently={canDeletePermanently}
          permanent={permanent}
          setPermanent={setPermanent}
          acknowledged={acknowledged}
          setAcknowledged={setAcknowledged}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </div>
    </Dialog>
  )
}
