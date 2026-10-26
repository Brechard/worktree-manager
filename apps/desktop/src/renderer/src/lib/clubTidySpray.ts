type Drop = {
  radius: number
  delay: number
  speed: number
  angle: number
}

export function playClubTidySpray(artwork: HTMLElement, bottle: HTMLImageElement) {
  const art = artwork.getBoundingClientRect()
  const workspace = artwork.closest('main')?.getBoundingClientRect()
  const left = Math.max(workspace?.left ?? 0, art.left - 350)
  const top = Math.max(workspace?.top ?? 0, art.top - 90)
  const width = Math.min(innerWidth - left, art.right + 140 - left)
  const height = Math.min(innerHeight - top, art.bottom + 100 - top)
  const x = art.left + art.width * 0.385 - left
  const y = art.top + art.height * 0.13 - top
  const theme = document.documentElement.dataset.theme
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const canvas = document.createElement('canvas')
  const scale = Math.min(devicePixelRatio, 1.5)
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  canvas.dataset.clubtidySpray = 'true'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
    zIndex: '40',
  })
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  ctx.scale(scale, scale)
  document.body.append(canvas)

  const mist = document.createElement('canvas')
  mist.width = mist.height = 64
  const mistContext = mist.getContext('2d')!
  const cloud = mistContext.createRadialGradient(32, 32, 0, 32, 32, 32)
  cloud.addColorStop(0, dark ? '#d7f4f05c' : '#7ba7b346')
  cloud.addColorStop(1, '#b0d5e000')
  mistContext.fillStyle = cloud
  mistContext.fillRect(0, 0, 64, 64)
  const random = (min: number, max: number) => min + Math.random() * (max - min)
  const drops: Drop[] = Array.from({ length: 230 }, (_, index) => ({
    radius: random(0.5, 2.5),
    delay: (index % 2) * 210 + random(70, 200),
    speed: random(200, 530),
    angle: Math.PI + random(-0.36, 0.36),
  }))
  const clouds = drops.slice(0, 28)
  const recoil = bottle.animate(
    [
      { transform: 'rotate(0deg) translateX(0)' },
      { transform: 'rotate(1.2deg) translateX(1.5px)', offset: 0.12 },
      { transform: 'rotate(-0.35deg) translateX(-0.5px)', offset: 0.25 },
      { transform: 'rotate(0.8deg) translateX(1px)', offset: 0.42 },
      { transform: 'rotate(-0.2deg) translateX(0)', offset: 0.6 },
      { transform: 'rotate(0deg) translateX(0)' },
    ],
    { duration: 720, easing: 'ease-in-out' }
  )
  const listeners = new AbortController()
  let frame = 0
  const dispose = () => {
    cancelAnimationFrame(frame)
    recoil.cancel()
    listeners.abort()
    canvas.remove()
  }
  window.addEventListener('resize', dispose, { signal: listeners.signal, once: true })
  document.addEventListener('visibilitychange', dispose, { signal: listeners.signal, once: true })
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', dispose, {
    signal: listeners.signal,
    once: true,
  })
  const started = performance.now()

  const paint = (now: number) => {
    const elapsed = now - started
    ctx.clearRect(0, 0, width, height)
    for (const drop of clouds) {
      const age = (elapsed - drop.delay) / 1000
      if (age < 0 || age > 1.5) continue
      const travel = (drop.speed * (1 - Math.exp(-age * 2))) / 2
      const radius = 12 + age * 55
      ctx.globalAlpha = Math.sin((age / 1.5) * Math.PI) * 0.43
      ctx.drawImage(
        mist,
        x + Math.cos(drop.angle) * travel - radius,
        y + Math.sin(drop.angle) * travel + age * 5 - radius,
        radius * 2,
        radius * 2
      )
    }
    for (const drop of drops) {
      const age = (elapsed - drop.delay) / 1000
      if (age < 0 || age > 1.2) continue
      const travel = (drop.speed * (1 - Math.exp(-age * 1.7))) / 1.7
      const dx = Math.cos(drop.angle)
      const dy = Math.sin(drop.angle)
      const px = x + dx * travel
      const py = y + dy * travel + 10 * age * age
      ctx.globalAlpha = Math.min(1, age * 18) * (1 - age / 1.2) * 0.8
      ctx.strokeStyle = dark ? '#e5fcff' : '#5c929f'
      ctx.lineWidth = drop.radius * (1 - age * 0.3)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px - dx * Math.max(1, 10 - age * 15), py - dy * Math.max(1, 10 - age * 15))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    if (elapsed < 1950) frame = requestAnimationFrame(paint)
    else dispose()
  }
  frame = requestAnimationFrame(paint)
  return dispose
}
