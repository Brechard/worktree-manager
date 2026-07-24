import { useEffect, useRef, useState } from 'react'
import {
  GitBranch,
  GitCommit,
  Download,
  Upload,
  RefreshCw,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { cn } from '../lib/utils'

interface GitActionsMenuProps {
  busy: 'editor' | 'terminal' | 'folder' | 'pull' | 'rebase' | 'push' | 'commit' | null
  showCommitInput: boolean
  onPull: () => void
  onRebase: () => void
  onPush: () => void
  onCommit: () => void
}

export function GitActionsMenu({
  busy,
  showCommitInput,
  onPull,
  onRebase,
  onPush,
  onCommit,
}: GitActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50'
  const busyIcon = <Loader2 className="h-3.5 w-3.5 animate-spin" />

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Git actions"
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors',
          open ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-foreground hover:bg-accent'
        )}
      >
        <GitBranch className="h-3 w-3" />
        Git
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-2xl ring-1 ring-border">
          <button
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
          <button
            onClick={() => {
              setOpen(false)
              onCommit()
            }}
            className={cn(itemClass, showCommitInput && 'bg-accent')}
          >
            <GitCommit className="h-3.5 w-3.5" />
            {showCommitInput ? 'Hide commit' : 'Commit…'}
          </button>
        </div>
      )}
    </div>
  )
}
