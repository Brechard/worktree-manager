import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownToLine,
  ChevronDown,
  GitMerge,
  ListRestart,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type { SyncBaseMode, SyncTarget, UpdateOffer } from '@worktree/contracts'
import { cn } from '../lib/utils'
import { describeCatchUp, type ProjectCatchUp } from '../lib/catchUp'
import { useFloatingMenu } from './useFloatingMenu'

interface SyncButtonProps {
  /**
   * Everything this worktree could bring in, most urgent first — its own
   * upstream before the base branch. The first one is what the main click runs;
   * the rest sit under the arrow so nothing that has commits waiting is hidden.
   */
  offers: UpdateOffer[]
  /** The repository's base branch, short name. */
  baseBranch: string
  /** The branch this worktree is on right now. */
  branch: string
  /** Mode a previous sync proved to be the working one, per target. */
  learned?: Partial<Record<SyncTarget, SyncBaseMode>> | undefined
  /**
   * Primary worktree only. Takes over the main click: once the base has moved
   * on, going back to it and bringing the whole project along beats replaying
   * this worktree onto it — that is the one thing the primary should not need.
   */
  catchUp?: ProjectCatchUp | undefined
  busy: boolean
  /** Another git action is running in this row. */
  disabled?: boolean
  onSync: (target: SyncTarget, mode: SyncBaseMode) => void
}

const SAFETY_NOTE =
  'Uncommitted changes are stashed and put back automatically. If it conflicts, everything is rolled back — the worktree is left exactly as it is now.'

const VERB: Record<SyncBaseMode, string> = { ff: 'Pull', rebase: 'Rebase', merge: 'Merge' }

const ICON: Record<SyncBaseMode, ReactNode> = {
  ff: <ArrowDownToLine className="h-3.5 w-3.5 shrink-0" />,
  rebase: <RefreshCw className="h-3.5 w-3.5 shrink-0" />,
  merge: <GitMerge className="h-3.5 w-3.5 shrink-0" />,
}

function plural(count: number): string {
  return count === 1 ? '' : 's'
}

/** What the chosen mode will do, in one sentence. */
function explain(offer: UpdateOffer, mode: SyncBaseMode): string {
  const commits = `${offer.behind} new commit${plural(offer.behind)}`
  switch (mode) {
    case 'ff':
      return `Fast-forward this branch to ${offer.ref}, bringing in its ${commits}. A plain pull: nothing of yours is replayed or merged.`
    case 'rebase':
      return `Rebase this branch onto ${offer.ref}, replaying your commits on top of its ${commits}.`
    case 'merge':
      return `Merge ${offer.ref} into this branch, bringing in its ${commits}.`
  }
}

/**
 * The one-click way to get this row up to date, and the only place that has to
 * decide *how*. Commits pushed to the branch's own upstream come first and are
 * usually a plain pull; the base branch comes second and is usually a rebase or
 * a merge. Whichever it is, the button says so before it is clicked, and the
 * alternatives are one click further rather than buried in the git menu.
 *
 * On the primary worktree with the base moved on, the project catch-up takes
 * the main click instead: rebasing the worktree that is supposed to *be* the
 * base is the wrong answer to "main shipped". The per-branch modes stay in the
 * dropdown for whoever really wants them.
 */
export function SyncButton({
  offers,
  baseBranch,
  branch,
  learned,
  catchUp,
  busy,
  disabled = false,
  onSync,
}: SyncButtonProps) {
  const [open, setOpen] = useState(false)
  const { anchorRef, menuRef, position } = useFloatingMenu(open, setOpen)

  const pick = (target: SyncTarget, mode: SyncBaseMode) => {
    setOpen(false)
    onSync(target, mode)
  }

  // What a sync actually proved beats what the branch's shape suggests.
  const resolved = offers.map((offer) => {
    const mode = learned?.[offer.target] ?? offer.mode
    return {
      ...offer,
      mode,
      ...(mode !== offer.mode
        ? {
            reason:
              offer.mode === 'ff'
                ? `A fast-forward cannot bring ${offer.ref} in any more — the two have diverged since, so a ${mode} it is.`
                : `A ${offer.mode} of ${offer.ref} does not apply cleanly here, but a ${mode} does.`,
          }
        : {}),
    }
  })
  const primary = resolved[0]
  const catchUpCopy = catchUp ? describeCatchUp(branch, baseBranch, catchUp.worktreeCount) : null
  const spinning = busy || catchUp?.running === true

  return (
    <div ref={anchorRef} className="relative">
      <div
        className={cn(
          'inline-flex items-center overflow-hidden rounded-md border border-primary/40 bg-primary/10 text-primary transition-colors',
          (spinning || disabled) && 'opacity-60'
        )}
      >
        {catchUp && catchUpCopy ? (
          <button
            type="button"
            onClick={() => catchUp.run()}
            disabled={spinning || disabled}
            title={[
              `Put ${baseBranch} back under this worktree and bring the whole project up to it: ${catchUpCopy.steps.join(', ')}.`,
              SAFETY_NOTE,
              primary
                ? `Use the arrow to update only this worktree from ${primary.ref} instead.`
                : undefined,
            ]
              .filter(Boolean)
              .join('\n\n')}
            className="inline-flex max-w-[300px] items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:cursor-default disabled:hover:bg-transparent"
          >
            {spinning ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <ListRestart className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{catchUpCopy.label}</span>
          </button>
        ) : (
          primary && (
            <button
              type="button"
              onClick={() => onSync(primary.target, primary.mode)}
              disabled={spinning || disabled}
              title={[
                explain(primary, primary.mode),
                primary.reason,
                SAFETY_NOTE,
                'Use the arrow for the other ways to do it.',
              ]
                .filter(Boolean)
                .join('\n\n')}
              className="inline-flex max-w-[300px] items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:cursor-default disabled:hover:bg-transparent"
            >
              {spinning ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                ICON[primary.mode]
              )}
              <span className="shrink-0">
                {VERB[primary.mode]} {primary.behind} commit{plural(primary.behind)} from
              </span>
              <span className="truncate font-mono">{primary.ref}</span>
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={spinning || disabled}
          title={
            catchUp
              ? 'What this does, and the alternatives'
              : `Choose how to bring in ${primary?.ref}`
          }
          aria-label={
            catchUp ? 'Show what the catch-up does' : `Choose how to update from ${primary?.ref}`
          }
          aria-expanded={open}
          className="border-l border-primary/30 px-1 py-1.5 hover:bg-primary/20 disabled:cursor-default disabled:hover:bg-transparent"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 w-64 rounded-md border border-border bg-background p-1 shadow-2xl ring-1 ring-border"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight,
              overflowY: position?.maxHeight === undefined ? undefined : 'auto',
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {catchUpCopy && (
              <>
                <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {catchUpCopy.label}
                </p>
                <ol className="mb-1 space-y-0.5 px-2 pb-1 text-[10px] leading-tight text-muted">
                  {catchUpCopy.steps.map((step, index) => (
                    <li key={step}>
                      {index + 1}. {step}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {resolved.map((offer, index) => (
              <div key={offer.target}>
                <p className="border-t border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {catchUpCopy && index === 0 ? 'Only this worktree · ' : ''}
                  {offer.behind} new commit{plural(offer.behind)} on {offer.ref}
                </p>
                {/* A fast-forward is only on the table while this branch has
                    nothing of its own — offering it after that is offering the
                    error the user just hit. */}
                {offer.ahead === 0 && (
                  <SyncOption
                    icon={ICON.ff}
                    label={`Pull ${offer.ref}`}
                    hint="Moves this branch straight onto them. Nothing of yours to replay or merge."
                    recommended={!catchUpCopy && offer.mode === 'ff'}
                    onClick={() => pick(offer.target, 'ff')}
                  />
                )}
                <SyncOption
                  icon={ICON.rebase}
                  label={`Rebase onto ${offer.ref}`}
                  hint="Replays your commits on top of them. Keeps history linear, but rewrites your commits."
                  recommended={!catchUpCopy && offer.mode === 'rebase'}
                  onClick={() => pick(offer.target, 'rebase')}
                />
                <SyncOption
                  icon={ICON.merge}
                  label={`Merge ${offer.ref} into this branch`}
                  hint="Adds a merge commit and leaves your commits untouched. Safer once the branch is pushed."
                  recommended={!catchUpCopy && offer.mode === 'merge'}
                  onClick={() => pick(offer.target, 'merge')}
                />
                {offer.reason && (
                  <p className="px-2 pb-1 pt-1 text-[10px] leading-relaxed text-muted">
                    {offer.reason}
                  </p>
                )}
              </div>
            ))}
            <p className="border-t border-border px-2 pb-1 pt-1.5 text-[10px] leading-relaxed text-muted">
              {SAFETY_NOTE}
            </p>
          </div>,
          document.body
        )}
    </div>
  )
}

function SyncOption({
  icon,
  label,
  hint,
  recommended,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint: string
  recommended: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <span className="flex w-full items-center gap-2 text-xs font-medium text-foreground">
        {icon}
        <span className="truncate">{label}</span>
        {recommended && (
          <span className="ml-auto shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            suggested
          </span>
        )}
      </span>
      <span className="pl-[22px] text-[10px] leading-tight text-muted">{hint}</span>
    </button>
  )
}
