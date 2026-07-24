import { useMemo, useState } from 'react'
import { cn } from '../lib/utils'

type DiffLine = {
  type: 'meta' | 'hunk' | 'context' | 'add' | 'del'
  raw: string
  oldLine?: number | undefined
  newLine?: number | undefined
}

export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const raw of diff.split('\n')) {
    if (
      raw.startsWith('diff --git') ||
      raw.startsWith('index ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity index') ||
      raw.startsWith('rename from') ||
      raw.startsWith('rename to') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('\\ No newline') ||
      raw.startsWith('Binary files')
    ) {
      lines.push({ type: 'meta', raw })
      inHunk = false
      continue
    }

    const hunkMatch = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1] || '0', 10)
      newLine = parseInt(hunkMatch[3] || '0', 10)
      inHunk = true
      lines.push({ type: 'hunk', raw })
      continue
    }

    if (!inHunk) {
      lines.push({ type: 'meta', raw })
      continue
    }

    if (raw.length === 0) {
      lines.push({ type: 'meta', raw })
      continue
    }

    const prefix = raw[0]
    if (prefix === ' ') {
      const o = oldLine || undefined
      const n = newLine || undefined
      if (oldLine) oldLine++
      if (newLine) newLine++
      lines.push({ type: 'context', raw, oldLine: o, newLine: n })
    } else if (prefix === '-') {
      const o = oldLine || undefined
      if (oldLine) oldLine++
      lines.push({ type: 'del', raw, oldLine: o })
    } else if (prefix === '+') {
      const n = newLine || undefined
      if (newLine) newLine++
      lines.push({ type: 'add', raw, newLine: n })
    } else if (raw.startsWith('\\')) {
      lines.push({ type: 'meta', raw })
    } else {
      lines.push({ type: 'meta', raw })
    }
  }

  return lines
}

export function DiffViewer({ diff, fullDiff }: { diff: string; fullDiff: string }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const [context, setContext] = useState<'diff' | 'full'>('diff')
  const source = context === 'full' ? fullDiff : diff
  const lines = useMemo(() => parseDiff(source), [source])

  const toggleClass = (active: boolean) =>
    cn(
      'rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'
    )

  const cellClass = (type: DiffLine['type']) =>
    cn(
      'min-h-[1.25rem] px-1 leading-4',
      type === 'add' && 'bg-emerald-500/10 text-emerald-400',
      type === 'del' && 'bg-rose-500/10 text-rose-400',
      type === 'hunk' && 'bg-primary/10 text-primary',
      (type === 'meta' || type === 'context') && 'text-foreground/80'
    )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
          <button onClick={() => setMode('unified')} className={toggleClass(mode === 'unified')}>
            Unified
          </button>
          <button onClick={() => setMode('split')} className={toggleClass(mode === 'split')}>
            Side by side
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
          <button onClick={() => setContext('diff')} className={toggleClass(context === 'diff')}>
            Diff only
          </button>
          <button onClick={() => setContext('full')} className={toggleClass(context === 'full')}>
            Whole file
          </button>
        </div>
      </div>

      {!source.trim() && <p className="text-[10px] text-muted">No diff to display.</p>}

      {source.trim() ? (mode === 'unified' ? (
        <div className="grid max-h-96 grid-cols-[2rem_2rem_1fr] overflow-auto rounded-md border border-border bg-background font-mono text-[10px]">
          {lines.map((line, i) => {
            if (line.type === 'meta' || line.type === 'hunk') {
              return (
                <div key={i} className={cn(cellClass(line.type), 'col-span-3 whitespace-pre')}>
                  {line.raw}
                </div>
              )
            }
            return (
              <div key={i} className={cn(cellClass(line.type), 'contents')}>
                <div className="text-right text-muted/60 select-none pr-1">{line.oldLine ?? ''}</div>
                <div className="text-right text-muted/60 select-none pr-1">{line.newLine ?? ''}</div>
                <div className="overflow-hidden whitespace-pre px-1">
                  <span className="select-none">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </span>
                  {line.raw.slice(1)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid max-h-96 grid-cols-[2rem_1fr_2rem_1fr] overflow-auto rounded-md border border-border bg-background font-mono text-[10px]">
          {lines.map((line, i) => {
            if (line.type === 'meta' || line.type === 'hunk') {
              return (
                <div key={i} className={cn(cellClass(line.type), 'col-span-4 whitespace-pre')}>
                  {line.raw}
                </div>
              )
            }
            const content = line.raw.slice(1)
            if (line.type === 'add') {
              return (
                <div key={i} className="contents">
                  <div className="bg-rose-500/5" />
                  <div className="bg-rose-500/5" />
                  <div className="text-right text-emerald-400/60 select-none pr-1">{line.newLine ?? ''}</div>
                  <div className="overflow-hidden whitespace-pre bg-emerald-500/10 px-1 text-emerald-400">
                    {content}
                  </div>
                </div>
              )
            }
            if (line.type === 'del') {
              return (
                <div key={i} className="contents">
                  <div className="text-right text-rose-400/60 select-none pr-1">{line.oldLine ?? ''}</div>
                  <div className="overflow-hidden whitespace-pre bg-rose-500/10 px-1 text-rose-400">
                    {content}
                  </div>
                  <div className="bg-emerald-500/5" />
                  <div className="bg-emerald-500/5" />
                </div>
              )
            }
            return (
              <div key={i} className="contents">
                <div className="text-right text-muted/60 select-none pr-1">{line.oldLine ?? ''}</div>
                <div className="overflow-hidden whitespace-pre px-1">{content}</div>
                <div className="text-right text-muted/60 select-none pr-1">{line.newLine ?? ''}</div>
                <div className="overflow-hidden whitespace-pre px-1">{content}</div>
              </div>
            )
          })}
        </div>
      )) : null}
    </div>
  )
}
