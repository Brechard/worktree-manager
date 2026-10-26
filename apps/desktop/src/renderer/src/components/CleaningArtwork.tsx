import { useEffect, useRef, useState } from 'react'
import { playClubTidySpray } from '../lib/clubTidySpray'

const cleaningArtwork = new URL('../assets/clubtidy-cleaning.webp', import.meta.url).href

export function CleaningArtwork({ className = '' }: { className?: string }) {
  const artwork = useRef<HTMLDivElement>(null)
  const bottle = useRef<HTMLImageElement>(null)
  const dispose = useRef<(() => void) | null>(null)
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sprayed, setSprayed] = useState(false)
  useEffect(
    () => () => {
      dispose.current?.()
      if (reset.current) clearTimeout(reset.current)
    },
    []
  )
  const spray = () => {
    dispose.current?.()
    if (reset.current) clearTimeout(reset.current)
    setSprayed(true)
    if (
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      artwork.current &&
      bottle.current
    ) {
      dispose.current = playClubTidySpray(artwork.current, bottle.current)
    }
    reset.current = setTimeout(() => setSprayed(false), 2000)
  }
  return (
    <div ref={artwork} className={`relative ${className}`}>
      <img
        ref={bottle}
        src={cleaningArtwork}
        alt=""
        width={640}
        height={427}
        className="pointer-events-none block h-auto w-full origin-[52%_78%]"
      />
      <button
        type="button"
        onClick={spray}
        aria-label="Spray the cleaning bottle"
        className="absolute top-[7%] right-[37%] bottom-[17%] left-[37%] rounded-3xl focus-visible:ring-2 focus-visible:ring-primary"
      />
      <span role="status" className="sr-only">
        {sprayed ? 'Freshly cleaned.' : ''}
      </span>
    </div>
  )
}
