import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GitBranch,
  GitCommit,
  GitMerge,
  ArrowDownToLine,
  Download,
  Upload,
  RefreshCw,
  RefreshCcw,
  ListRestart,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from 'lucide-react'
import type { SyncBaseMode, SyncTarget, UpdateOffer } from '@worktree/contracts'
import { cn } from '../lib/utils'
import { describeCatchUp, type ProjectCatchUp } from '../lib/catchUp'
import { useFloatingMenu } from './useFloatingMenu'
import { Button } from './ui/Button'

const BusyIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" />

const itemClass =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-50'

export type MergeMode = 'merge' | 'no-ff' | 'squash' | 'rebase'

interface GitActionsMenuProps {
  busy:
    | 'editor'
    | 'terminal'
    | 'folder'
    | 'action'
    | 'pull'
    | 'rebase'
    | 'push'
    | 'commit'
    | 'updateBase'
    | 'checkout'
    | 'merge'
    | 'sync'
    | null
  branch: string
  baseBranch: string
  /** Commits waiting on the base ref, with the mode that suits them — absent
   *  when the branch is level with the base (or there is no branch at all). */
  baseOffer?: UpdateOffer | undefined
  /** The same, for commits waiting on this branch's own upstream. */
  upstreamOffer?: UpdateOffer | undefined
  /** Set on the primary worktree when the project is worth catching up. */
  catchUp?: ProjectCatchUp | undefined
  /** A project-wide operation is moving this worktree; keep hands off the menu. */
  blocked?: boolean | undefined
  showCommitInput: boolean
  loadBranches: () => Promise<string[]>
  onPull: () => void
  onRebase: () => void
  onPush: () => void
  onCommit: () => void
  onUpdateBaseBranch: () => void
  onCheckout: (branch: string) => void
  onMerge: (branch: string, mode: MergeMode) => void
  onSync: (target: SyncTarget, mode: SyncBaseMode) => void
}

type View = 'root' | 'checkout' | 'merge' | 'merge-mode'

function SuggestedTag() {
  return (
    <span className="ml-auto shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
      suggested
    </span>
  )
}

const MERGE_MODES: { mode: MergeMode; label: string; hint: string }[] = [
  { mode: 'merge', label: 'Merge commit', hint: 'git merge' },
  { mode: 'no-ff', label: 'Merge (no fast-forward)', hint: 'git merge --no-ff' },
  { mode: 'squash', label: 'Squash merge', hint: 'git merge --squash' },
  { mode: 'rebase', label: 'Rebase onto', hint: 'git rebase' },
]

export function GitActionsMenu({
  busy,
  branch,
  baseBranch,
  baseOffer,
  upstreamOffer,
  catchUp,
  blocked,
  showCommitInput,
  loadBranches,
  onPull,
  onRebase,
  onPush,
  onCommit,
  onUpdateBaseBranch,
  onCheckout,
  onMerge,
  onSync,
}: GitActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const { anchorRef, menuRef, triggerRef, menuId, position, closeWithFocus } = useFloatingMenu(
    open,
    setOpen
  )

  // The catch-up rebases every worktree in the project, this one included, so
  // while it runs nothing in the menu may start on top of it.
  const locked = Boolean(busy) || blocked === true
  const catchUpCopy = catchUp ? describeCatchUp(branch, baseBranch, catchUp.worktreeCount) : null

  // Reset navigation state whenever the menu closes.
  useEffect(() => {
    if (!open) {
      setView('root')
      setQuery('')
      setTarget(null)
    }
  }, [open])

  const openBranchList = async (next: 'checkout' | 'merge') => {
    setView(next)
    setQuery('')
    if (branches.length === 0) {
      setLoading(true)
      try {
        setBranches(await loadBranches())
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div ref={anchorRef} className="relative">
      <Button
        ref={triggerRef}
        variant={open ? 'primary' : 'neutral'}
        onClick={() => setOpen((v) => !v)}
        title="Git actions"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <GitBranch className="h-3.5 w-3.5" />
        Git
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            className="fixed z-50 w-56 rounded-md border border-border bg-background p-1 shadow-2xl ring-1 ring-border"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight,
              overflowY: position?.maxHeight === undefined ? undefined : 'auto',
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            <GitActionsPanel
              {...{
                busy,
                branch,
                baseBranch,
                baseOffer,
                upstreamOffer,
                catchUp,
                showCommitInput,
                onPull,
                onRebase,
                onPush,
                onCommit,
                onUpdateBaseBranch,
                onSync,
                onCheckout,
                onMerge,
              }}
              view={view}
              setView={setView}
              branches={branches}
              loading={loading}
              query={query}
              setQuery={setQuery}
              target={target}
              setTarget={setTarget}
              locked={locked}
              catchUpCopy={catchUpCopy}
              closeWithFocus={closeWithFocus}
              openBranchList={openBranchList}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

interface GitActionsPanelProps
  extends GitActionsRootProps, Pick<GitActionsMenuProps, 'onCheckout' | 'onMerge'> {
  view: View
  setView: (view: View) => void
  branches: string[]
  loading: boolean
  query: string
  setQuery: (value: string) => void
  target: string | null
  setTarget: (target: string | null) => void
}

function GitActionsPanel({
  view,
  setView,
  branches,
  loading,
  query,
  setQuery,
  target,
  setTarget,
  busy,
  branch,
  baseBranch,
  baseOffer,
  upstreamOffer,
  catchUp,
  showCommitInput,
  onPull,
  onRebase,
  onPush,
  onCommit,
  onUpdateBaseBranch,
  onSync,
  onCheckout,
  onMerge,
  locked,
  catchUpCopy,
  closeWithFocus,
  openBranchList,
}: GitActionsPanelProps) {
  const header = (title: string, back: View) => (
    <button
      type="button"
      onClick={() => setView(back)}
      className="mb-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {title}
    </button>
  )

  return (
    <>
      {view === 'root' && (
        <GitActionsRoot
          {...{
            busy,
            branch,
            baseBranch,
            baseOffer,
            upstreamOffer,
            catchUp,
            showCommitInput,
            onPull,
            onRebase,
            onPush,
            onCommit,
            onUpdateBaseBranch,
            onSync,
          }}
          locked={locked}
          catchUpCopy={catchUpCopy}
          closeWithFocus={closeWithFocus}
          openBranchList={openBranchList}
        />
      )}

      {view === 'checkout' && (
        <>
          {header('Checkout branch', 'root')}
          <BranchList
            branch={branch}
            baseBranch={baseBranch}
            branches={branches}
            loading={loading}
            query={query}
            setQuery={setQuery}
            onPick={(b) => {
              closeWithFocus()
              onCheckout(b)
            }}
          />
        </>
      )}

      {view === 'merge' && (
        <>
          {header('Merge branch into ' + branch, 'root')}
          <BranchList
            branch={branch}
            baseBranch={baseBranch}
            branches={branches}
            loading={loading}
            query={query}
            setQuery={setQuery}
            onPick={(b) => {
              setTarget(b)
              setView('merge-mode')
            }}
          />
        </>
      )}

      {view === 'merge-mode' && target && (
        <>
          {header('Merge ' + target, 'merge')}
          {MERGE_MODES.map(({ mode, label, hint }) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                closeWithFocus()
                onMerge(target, mode)
              }}
              className={cn(itemClass, 'flex-col items-start gap-0.5')}
            >
              <span className="flex items-center gap-2">
                {mode === 'rebase' ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <GitMerge className="h-3.5 w-3.5" />
                )}
                {label}
              </span>
              <span className="pl-6 font-mono text-xs text-muted">
                {hint} {target}
              </span>
            </button>
          ))}
        </>
      )}
    </>
  )
}

interface GitActionsRootProps extends Pick<
  GitActionsMenuProps,
  | 'busy'
  | 'branch'
  | 'baseBranch'
  | 'baseOffer'
  | 'upstreamOffer'
  | 'catchUp'
  | 'showCommitInput'
  | 'onPull'
  | 'onRebase'
  | 'onPush'
  | 'onCommit'
  | 'onUpdateBaseBranch'
  | 'onSync'
> {
  locked: boolean
  catchUpCopy: ReturnType<typeof describeCatchUp> | null
  closeWithFocus: () => void
  openBranchList: (view: 'checkout' | 'merge') => void
}

function GitActionsRoot(props: GitActionsRootProps) {
  return (
    <>
      <GitBaseActions {...props} />
      <GitUpstreamActions {...props} />
      <GitNavigationActions {...props} />
    </>
  )
}

function GitBaseActions(props: GitActionsRootProps) {
  return (
    <>
      <GitCatchUpAction {...props} />
      <GitBaseOfferActions {...props} />
    </>
  )
}

function GitCatchUpAction({
  catchUp,
  catchUpCopy,
  baseBranch,
  locked,
  closeWithFocus,
}: GitActionsRootProps) {
  return (
    <>
      {catchUp && catchUpCopy && (
        <>
          <button
            type="button"
            onClick={() => {
              closeWithFocus()
              catchUp.run()
            }}
            disabled={locked}
            title={`Put ${baseBranch} back under this worktree, pull it, then bring every other worktree up to it.`}
            className={cn(
              itemClass,
              'flex-col items-start gap-0.5',
              catchUp.running && 'bg-accent'
            )}
          >
            <span className="flex w-full items-center gap-2 font-medium">
              {catchUp.running ? BusyIcon : <ListRestart className="h-3.5 w-3.5 text-primary" />}
              {catchUpCopy.label}
            </span>
            <span className="pl-6 text-xs leading-snug text-muted">
              {catchUpCopy.steps.join(' · ')}
            </span>
          </button>
          <div className="my-1 border-t border-border" />
        </>
      )}
    </>
  )
}

function GitBaseOfferActions({
  baseOffer,
  busy,
  locked,
  closeWithFocus,
  onSync,
}: GitActionsRootProps) {
  return (
    <>
      {baseOffer && (
        <>
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {baseOffer.behind} new commit{baseOffer.behind === 1 ? '' : 's'} on {baseOffer.ref}
          </p>
          {/* Nothing of ours in the way, so the base can simply be
                        walked onto — offered first because it is the cheapest
                        thing that works. */}
          {baseOffer.ahead === 0 && (
            <button
              type="button"
              onClick={() => {
                closeWithFocus()
                onSync('base', 'ff')
              }}
              disabled={locked}
              className={cn(itemClass, busy === 'sync' && 'bg-accent')}
            >
              {busy === 'sync' ? BusyIcon : <ArrowDownToLine className="h-3.5 w-3.5" />}
              Fast-forward to {baseOffer.ref}
              {baseOffer.mode === 'ff' && <SuggestedTag />}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              closeWithFocus()
              onSync('base', 'rebase')
            }}
            disabled={locked}
            className={cn(itemClass, busy === 'sync' && baseOffer.ahead > 0 && 'bg-accent')}
          >
            {busy === 'sync' && baseOffer.ahead > 0 ? (
              BusyIcon
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Rebase onto {baseOffer.ref}
            {baseOffer.mode === 'rebase' && <SuggestedTag />}
          </button>
          <button
            type="button"
            onClick={() => {
              closeWithFocus()
              onSync('base', 'merge')
            }}
            disabled={locked}
            className={itemClass}
          >
            <GitMerge className="h-3.5 w-3.5" />
            Merge {baseOffer.ref} in
            {baseOffer.mode === 'merge' && <SuggestedTag />}
          </button>
          <div className="my-1 border-t border-border" />
        </>
      )}
    </>
  )
}

function GitUpstreamActions(props: GitActionsRootProps) {
  return (
    <>
      <GitUpdateBaseAction {...props} />
      <GitUpstreamBranchActions {...props} />
    </>
  )
}

function GitUpdateBaseAction({
  branch,
  baseBranch,
  busy,
  locked,
  closeWithFocus,
  onUpdateBaseBranch,
}: GitActionsRootProps) {
  return (
    <>
      {branch !== baseBranch && (
        <button
          type="button"
          onClick={() => {
            closeWithFocus()
            onUpdateBaseBranch()
          }}
          disabled={locked}
          className={cn(itemClass, busy === 'updateBase' && 'bg-accent')}
        >
          {busy === 'updateBase' ? BusyIcon : <RefreshCcw className="h-3.5 w-3.5" />}
          Update {baseBranch}
        </button>
      )}
    </>
  )
}

function GitUpstreamBranchActions({
  upstreamOffer,
  busy,
  locked,
  closeWithFocus,
  onPull,
  onRebase,
  onSync,
  onPush,
}: GitActionsRootProps) {
  return (
    <>
      {upstreamOffer && (
        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {upstreamOffer.behind} new commit{upstreamOffer.behind === 1 ? '' : 's'} on{' '}
          {upstreamOffer.ref}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          closeWithFocus()
          onPull()
        }}
        disabled={locked}
        className={cn(itemClass, busy === 'pull' && 'bg-accent')}
      >
        {busy === 'pull' ? BusyIcon : <Download className="h-3.5 w-3.5" />}
        Pull fast-forward
        {upstreamOffer?.mode === 'ff' && <SuggestedTag />}
      </button>
      <button
        type="button"
        onClick={() => {
          closeWithFocus()
          onRebase()
        }}
        disabled={locked}
        className={cn(itemClass, busy === 'rebase' && 'bg-accent')}
      >
        {busy === 'rebase' ? BusyIcon : <RefreshCw className="h-3.5 w-3.5" />}
        Pull with rebase
        {upstreamOffer?.mode === 'rebase' && <SuggestedTag />}
      </button>
      {/* Only once the branch and its upstream have actually diverged:
                    before that a merge is just a fast-forward wearing a hat. */}
      {upstreamOffer && upstreamOffer.ahead > 0 && (
        <button
          type="button"
          onClick={() => {
            closeWithFocus()
            onSync('upstream', 'merge')
          }}
          disabled={locked}
          className={itemClass}
        >
          <GitMerge className="h-3.5 w-3.5" />
          Merge {upstreamOffer.ref} in
          {upstreamOffer.mode === 'merge' && <SuggestedTag />}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          closeWithFocus()
          onPush()
        }}
        disabled={locked}
        className={cn(itemClass, busy === 'push' && 'bg-accent')}
      >
        {busy === 'push' ? BusyIcon : <Upload className="h-3.5 w-3.5" />}
        Push branch
      </button>
      <div className="my-1 border-t border-border" />
    </>
  )
}

function GitNavigationActions({
  busy,
  showCommitInput,
  locked,
  closeWithFocus,
  openBranchList,
  onCommit,
}: GitActionsRootProps) {
  return (
    <>
      <button
        type="button"
        onClick={() => openBranchList('checkout')}
        disabled={locked}
        className={cn(itemClass, busy === 'checkout' && 'bg-accent')}
      >
        {busy === 'checkout' ? BusyIcon : <GitBranch className="h-3.5 w-3.5" />}
        Checkout…
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
      </button>
      <button
        type="button"
        onClick={() => openBranchList('merge')}
        disabled={locked}
        className={cn(itemClass, busy === 'merge' && 'bg-accent')}
      >
        {busy === 'merge' ? BusyIcon : <GitMerge className="h-3.5 w-3.5" />}
        Merge…
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
      </button>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        onClick={() => {
          closeWithFocus()
          onCommit()
        }}
        className={cn(itemClass, showCommitInput && 'bg-accent')}
      >
        <GitCommit className="h-3.5 w-3.5" />
        {showCommitInput ? 'Hide commit' : 'Commit…'}
      </button>
    </>
  )
}

interface BranchListProps {
  branch: string
  baseBranch: string
  branches: string[]
  loading: boolean
  query: string
  setQuery: (q: string) => void
  onPick: (b: string) => void
}

function BranchList({
  branch,
  baseBranch,
  branches,
  loading,
  query,
  setQuery,
  onPick,
}: BranchListProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = branches.filter(
    (b) => b !== branch && b.toLowerCase().includes(query.trim().toLowerCase())
  )
  const showBase = baseBranch !== branch && filtered.includes(baseBranch)
  const rest = showBase ? filtered.filter((b) => b !== baseBranch) : filtered

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter branches…"
        aria-label="Filter branches"
        className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
      />
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
            {BusyIcon}
            Loading branches…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted">No branches found.</p>
        ) : (
          <>
            {showBase && (
              <>
                <button
                  type="button"
                  onClick={() => onPick(baseBranch)}
                  title={baseBranch}
                  className={cn(itemClass, 'font-mono')}
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">{baseBranch}</span>
                  <span className="ml-auto shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-wide text-primary">
                    base
                  </span>
                </button>
                {rest.length > 0 && <div className="my-1 border-t border-border" />}
              </>
            )}
            {rest.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => onPick(b)}
                title={b}
                className={cn(itemClass, 'font-mono')}
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">{b}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  )
}
