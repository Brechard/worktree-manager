import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

interface TitleBarProps {
  title?: string
  trailing?: ReactNode
  className?: string
}

/** Full-width draggable chrome so the window is easy to move on macOS. */
export function TitleBar({ title, trailing, className }: TitleBarProps) {
  return (
    <header
      className={cn(
        'titlebar flex h-12 shrink-0 items-center border-b border-border bg-card/80 px-4 backdrop-blur-sm',
        className
      )}
    >
      {/* Leave room for traffic lights on macOS hiddenInset */}
      <div className="w-[72px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? (
          <h1 className="truncate text-[13px] font-semibold tracking-tight text-foreground/90">
            {title}
          </h1>
        ) : null}
      </div>
      {trailing ? (
        <div className="titlebar-no-drag ml-3 flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : (
        <div className="w-[72px] shrink-0" aria-hidden />
      )}
    </header>
  )
}
