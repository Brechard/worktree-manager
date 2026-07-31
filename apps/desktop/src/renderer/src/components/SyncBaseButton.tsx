import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ChevronDown, GitMerge, Loader2, RefreshCw } from 'lucide-react'
import type { SyncBaseMode } from '@worktree/contracts'
import { cn } from '../lib/utils'
import { useFloatingMenu } from './useFloatingMenu'

interface SyncBaseButtonProps {
  /** Commits the base ref has that this branch does not. */
  behind: number
  /** Display ref the commits come from, e.g. `origin/main`. */
  baseRef: string
  /** The mode the primary click runs — whichever one actually suits this branch. */
  mode: SyncBaseMode
  /** Why `mode` was picked, when it is not the plain default. */
  reason?: string | undefined
  busy: boolean
  /** Another git action is running in this row. */
  disabled?: boolean
  onSync: (mode: SyncBaseMode) => void
}

const SAFETY_NOTE =
  'Uncommitted changes are stashed and put back automatically. If it conflicts, everything is rolled back — the worktree is left exactly as it is now.'

const VERB: Record<SyncBaseMode, string> = { rebase: 'Rebase', merge: 'Merge' }

/**
 * The one-click way to pull the base branch in. The primary action is whichever
 * mode suits the branch — rebase for a private linear branch, merge once the
 * branch is pushed or has merged the base in before — so the common case is one
 * click and the other mode is one click further, not buried in the git menu.
 */
export function SyncBaseButton({
  behind,
  baseRef,
  mode,
  reason,
  busy,
  disabled = false,
  onSync,
}: SyncBaseButtonProps) {
  const [open, setOpen] = useState(false)
  const { anchorRef, menuRef, position } = useFloatingMenu(open, setOpen)

  const pick = (mode: SyncBaseMode) => {
    setOpen(false)
    onSync(mode)
  }

  return (
    <div ref={anchorRef} className="relative">
      <div
        className={cn(
          'inline-flex items-center overflow-hidden rounded-md border border-primary/40 bg-primary/10 text-primary transition-colors',
          (busy || disabled) && 'opacity-60'
        )}
      >
        <button
          type="button"
          onClick={() => onSync(mode)}
          disabled={busy || disabled}
          title={[
            mode === 'rebase'
              ? `Rebase this branch onto ${baseRef}, replaying your commits on top of its ${behind} new commit${behind === 1 ? '' : 's'}.`
              : `Merge ${baseRef} into this branch, bringing in its ${behind} new commit${behind === 1 ? '' : 's'}.`,
            reason,
            SAFETY_NOTE,
            'Use the arrow for the other mode.',
          ]
            .filter(Boolean)
            .join('\n\n')}
          className="inline-flex max-w-[260px] items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-primary/20 disabled:cursor-default disabled:hover:bg-transparent"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="shrink-0">
            {VERB[mode]} {behind} commit{behind === 1 ? '' : 's'} from
          </span>
          <span className="truncate font-mono">{baseRef}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={busy || disabled}
          title={`Choose how to bring in ${baseRef}`}
          aria-label={`Choose how to sync with ${baseRef}`}
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
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {behind} new commit{behind === 1 ? '' : 's'} on {baseRef}
            </p>
            <SyncOption
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              label={`Rebase onto ${baseRef}`}
              hint="Replays your commits on top of them. Keeps history linear, but rewrites your commits."
              recommended={mode === 'rebase'}
              onClick={() => pick('rebase')}
            />
            <SyncOption
              icon={<GitMerge className="h-3.5 w-3.5" />}
              label={`Merge ${baseRef} into this branch`}
              hint="Adds a merge commit and leaves your commits untouched. Safer once the branch is pushed."
              recommended={mode === 'merge'}
              onClick={() => pick('merge')}
            />
            {reason && (
              <p className="border-t border-border px-2 pt-1.5 text-[10px] leading-relaxed text-muted">
                {reason}
              </p>
            )}
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
