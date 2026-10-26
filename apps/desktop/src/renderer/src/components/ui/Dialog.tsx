import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface DialogProps {
  titleId: string
  onClose: () => void
  size?: 'compact' | 'standard' | 'wide'
  initialFocus?: string
  canClose?: boolean
  closeOnBackdrop?: boolean
  children: ReactNode
  className?: string
}

/** The browser provides modal focus containment and an inert background. */
export function Dialog({
  titleId,
  onClose,
  size = 'standard',
  initialFocus,
  canClose = true,
  closeOnBackdrop = true,
  children,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  const canCloseRef = useRef(canClose)
  const closeOnBackdropRef = useRef(closeOnBackdrop)
  const initialFocusRef = useRef(initialFocus)
  useLayoutEffect(() => {
    closeRef.current = onClose
    canCloseRef.current = canClose
    closeOnBackdropRef.current = closeOnBackdrop
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handleCancel = (event: Event) => {
      event.preventDefault()
      if (canCloseRef.current) closeRef.current()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        !(event.target instanceof Element) ||
        event.target.closest('dialog') !== dialog
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (canCloseRef.current) closeRef.current()
    }
    const handleBackdrop = (event: MouseEvent) => {
      const bounds = dialog.getBoundingClientRect()
      const outside =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      if (event.target === dialog && outside && closeOnBackdropRef.current && canCloseRef.current) {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
      }
    }
    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('keydown', handleEscape)
    dialog.addEventListener('mousedown', handleBackdrop)
    dialog.showModal()
    if (initialFocusRef.current) dialog.querySelector<HTMLElement>(initialFocusRef.current)?.focus()
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('keydown', handleEscape)
      dialog.removeEventListener('mousedown', handleBackdrop)
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={cn('ui-dialog', `ui-dialog--${size}`, className)}
    >
      {children}
    </dialog>
  )
}
