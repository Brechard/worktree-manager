import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'

interface TitleBarProps {
  title?: string
  trailing?: ReactNode
  className?: string
}

/** Full-width draggable chrome so the window is easy to move on macOS. */
export function TitleBar({ title, trailing, className }: TitleBarProps) {
  const [isDev, setIsDev] = useState(false)

  useEffect(() => {
    window.api
      ?.isDev()
      .then(setIsDev)
      .catch(() => {})
  }, [])

  return (
    <header
      className={cn(
        'titlebar flex h-12 shrink-0 items-center border-b border-border bg-card/80 px-4 backdrop-blur-sm',
        isDev && 'border-b-warning/60',
        className
      )}
    >
      {/* Leave room for traffic lights on macOS hiddenInset */}
      <div className="w-[72px] shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {title ? (
          <h1 className="truncate text-[13px] font-semibold tracking-tight text-foreground/90">
            {title}
          </h1>
        ) : null}
        {isDev && (
          <span className="shrink-0 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
            Dev
          </span>
        )}
      </div>
      {trailing ? (
        <div className="titlebar-no-drag ml-3 flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : (
        <div className="w-[72px] shrink-0" aria-hidden />
      )}
    </header>
  )
}
