import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'
import type { EditorOption } from '../lib/paths'
import { getEditorIcon } from './EditorIcons'

interface EditorPickerProps {
  value: string
  defaultOptionLabel: string
  defaultEditorId: string | undefined
  options: EditorOption[]
  editorIcons: Record<string, string>
  onChange: (value: string) => void
}

function EditorIcon({
  editorId,
  editorIcons,
  className,
}: {
  editorId: string | undefined
  editorIcons: Record<string, string>
  className?: string
}) {
  const iconSrc = editorId ? editorIcons[editorId] : undefined
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [iconSrc, editorId])

  if (iconSrc && !failed) {
    return (
      <img
        src={iconSrc}
        alt=""
        className={cn('h-4 w-4 rounded-sm object-contain', className)}
        onError={() => setFailed(true)}
      />
    )
  }

  const Icon = editorId ? getEditorIcon(editorId) : undefined
  if (Icon) return <Icon className={cn('h-4 w-4', className)} />
  return <AppWindow className={cn('h-4 w-4 text-muted', className)} />
}

export function EditorPicker({
  value,
  defaultOptionLabel,
  defaultEditorId,
  options,
  editorIcons,
  onChange,
}: EditorPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const closeOnOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const selectedOption = useMemo(() => options.find((option) => option.id === value), [options, value])
  const selectedLabel = value ? selectedOption?.label ?? value : defaultOptionLabel
  const selectedEditorId = value || defaultEditorId

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md bg-transparent px-1 py-0.5 text-left text-xs font-medium hover:bg-accent"
        title="Editor for this project"
      >
        <EditorIcon editorId={selectedEditorId} editorIcons={editorIcons} className="h-3.5 w-3.5" />
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-background p-1 shadow-2xl ring-1 ring-border">
          <button
            type="button"
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent',
              !value && 'bg-accent'
            )}
          >
            <EditorIcon editorId={defaultEditorId} editorIcons={editorIcons} className="h-3.5 w-3.5" />
            <span className="truncate">{defaultOptionLabel}</span>
            {!value && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </button>

          <div className="my-1 border-t border-border" />

          <div className="max-h-72 overflow-y-auto">
            {options.map((option) => {
              const selected = value === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent',
                    selected && 'bg-accent'
                  )}
                >
                  <EditorIcon editorId={option.id} editorIcons={editorIcons} className="h-3.5 w-3.5" />
                  <span className="truncate">{option.label}</span>
                  {selected && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
