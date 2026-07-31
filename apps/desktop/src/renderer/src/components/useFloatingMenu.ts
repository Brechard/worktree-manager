import { useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

interface FloatingMenuPosition {
  top: number
  left: number
  maxHeight: number | undefined
}

const VIEWPORT_PADDING = 8
const MENU_GAP = 4

/**
 * Positions a menu outside of the row's overflow and scroll containers.
 * Menus close when the page/list scrolls so they cannot drift away from their
 * trigger, and flip above the trigger when there is not enough room below.
 */
export function useFloatingMenu(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor || !menu) return

      const anchorRect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const spaceBelow = Math.max(
        0,
        window.innerHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_PADDING
      )
      const spaceAbove = Math.max(0, anchorRect.top - MENU_GAP - VIEWPORT_PADDING)
      const opensAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow
      const availableSpace = opensAbove ? spaceAbove : spaceBelow
      const height = Math.min(menuRect.height, availableSpace)
      const left = Math.min(
        Math.max(VIEWPORT_PADDING, anchorRect.right - menuRect.width),
        Math.max(VIEWPORT_PADDING, window.innerWidth - menuRect.width - VIEWPORT_PADDING)
      )

      setPosition({
        top: opensAbove ? anchorRect.top - MENU_GAP - height : anchorRect.bottom + MENU_GAP,
        left,
        maxHeight: availableSpace < menuRect.height ? availableSpace : undefined,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)

    const resizeObserver = new ResizeObserver(updatePosition)
    if (menuRef.current) resizeObserver.observe(menuRef.current)

    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnPointerDown)

    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('scroll', closeOnScroll, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      resizeObserver.disconnect()
      document.removeEventListener('mousedown', closeOnPointerDown)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [open, setOpen])

  return { anchorRef, menuRef, position }
}
