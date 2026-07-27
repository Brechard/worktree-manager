import { useEffect, useRef, useState } from 'react'
import {
  GitBranch,
  GitCommit,
  GitMerge,
  Download,
  Upload,
  RefreshCw,
  RefreshCcw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Loader2,
} from 'lucide-react'
import { cn } from '../lib/utils'

export type MergeMode = 'merge' | 'no-ff' | 'squash' | 'rebase'

interface GitActionsMenuProps {
  busy:
    | 'editor'
    | 'terminal'
    | 'folder'
    | 'pull'
    | 'rebase'
    | 'push'
    | 'commit'
    | 'updateBase'
    | 'checkout'
    | 'merge'
    | null
  branch: string
  baseBranch: string
  showCommitInput: boolean
  loadBranches: () => Promise<string[]>
  onPull: () => void
  onRebase: () => void
  onPush: () => void
  onCommit: () => void
  onUpdateBaseBranch: () => void
  onCheckout: (branch: string) => void
  onMerge: (branch: string, mode: MergeMode) => void
}

type View = 'root' | 'checkout' | 'merge' | 'merge-mode'

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
  showCommitInput,
  loadBranches,
  onPull,
  onRebase,
  onPush,
  onCommit,
  onUpdateBaseBranch,
  onCheckout,
  onMerge,
}: GitActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

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

  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50'
  const busyIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" />

  // Exclude the branch already checked out here — checking it out or merging it
  // into itself is a no-op.
  const filtered = branches
    .filter((b) => b !== branch)
    .filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()))

  // Surface the base branch at the top (it's the most common checkout/merge
  // target) with a badge, separated from the rest — but only when it isn't the
  // branch already checked out here.
  const showBase = baseBranch !== branch && filtered.includes(baseBranch)
  const rest = showBase ? filtered.filter((b) => b !== baseBranch) : filtered

  const header = (title: string, back: View) => (
    <button
      type="button"
      onClick={() => setView(back)}
      className="mb-1 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {title}
    </button>
  )

  const branchList = (onPick: (b: string) => void) => (
    <>
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter branches…"
        className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
      />
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted">
            {busyIcon}
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Git actions"
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
          open
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/60 text-foreground hover:bg-accent'
        )}
      >
        <GitBranch className="h-3 w-3" />
        Git
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-background p-1 shadow-2xl ring-1 ring-border">
          {view === 'root' && (
            <>
              {branch !== baseBranch && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onUpdateBaseBranch()
                  }}
                  disabled={Boolean(busy)}
                  className={cn(itemClass, busy === 'updateBase' && 'bg-accent')}
                >
                  {busy === 'updateBase' ? busyIcon : <RefreshCcw className="h-3.5 w-3.5" />}
                  Update {baseBranch}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPull()
                }}
                disabled={Boolean(busy)}
                className={cn(itemClass, busy === 'pull' && 'bg-accent')}
              >
                {busy === 'pull' ? busyIcon : <Download className="h-3.5 w-3.5" />}
                Pull fast-forward
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onRebase()
                }}
                disabled={Boolean(busy)}
                className={cn(itemClass, busy === 'rebase' && 'bg-accent')}
              >
                {busy === 'rebase' ? busyIcon : <RefreshCw className="h-3.5 w-3.5" />}
                Pull with rebase
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPush()
                }}
                disabled={Boolean(busy)}
                className={cn(itemClass, busy === 'push' && 'bg-accent')}
              >
                {busy === 'push' ? busyIcon : <Upload className="h-3.5 w-3.5" />}
                Push branch
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => openBranchList('checkout')}
                disabled={Boolean(busy)}
                className={cn(itemClass, busy === 'checkout' && 'bg-accent')}
              >
                {busy === 'checkout' ? busyIcon : <GitBranch className="h-3.5 w-3.5" />}
                Checkout…
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
              </button>
              <button
                type="button"
                onClick={() => openBranchList('merge')}
                disabled={Boolean(busy)}
                className={cn(itemClass, busy === 'merge' && 'bg-accent')}
              >
                {busy === 'merge' ? busyIcon : <GitMerge className="h-3.5 w-3.5" />}
                Merge…
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted" />
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onCommit()
                }}
                className={cn(itemClass, showCommitInput && 'bg-accent')}
              >
                <GitCommit className="h-3.5 w-3.5" />
                {showCommitInput ? 'Hide commit' : 'Commit…'}
              </button>
            </>
          )}

          {view === 'checkout' && (
            <>
              {header('Checkout branch', 'root')}
              {branchList((b) => {
                setOpen(false)
                onCheckout(b)
              })}
            </>
          )}

          {view === 'merge' && (
            <>
              {header('Merge branch into ' + branch, 'root')}
              {branchList((b) => {
                setTarget(b)
                setView('merge-mode')
              })}
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
                    setOpen(false)
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
                  <span className="pl-6 font-mono text-[10px] text-muted">
                    {hint} {target}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
