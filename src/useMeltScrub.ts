import { useEffect, useRef, useState } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
type Tier = { count: number; dir: string; extension: string; keyframes: { step: number } }
type Manifest = Record<string, { desktop: Tier; mobile: Tier }>

/**
 * Every drawable image has the full resolution of its device tier. A permanent
 * set of full-resolution keyframes spans the timeline; a bounded detail cache
 * fills in nearby frames. Fast scrolling blends the surrounding sharp images,
 * never an enlarged thumbnail, and never waits for the entire sequence.
 */
export function useMeltScrub(manifestUrl: string, variant: string, paused = false) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [introProgress, setIntroProgress] = useState(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const syncRef = useRef<() => void>(() => {})
  useEffect(() => { syncRef.current() }, [paused])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const controller = new AbortController()
    const frames = new Map<number, ImageBitmap>()
    const pending = new Set<number>()
    const failed = new Set<number>()
    const keys = new Set<number>()
    let sorted: number[] = []
    const mobile = matchMedia('(pointer: coarse)').matches
    const upright = matchMedia('(orientation: portrait)')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const detailLimit = mobile ? 16 : 18
    let tier: Tier | undefined
    let stopped = false
    let target = 0
    let current = 0
    let introTarget = 0
    let introCurrent = 0
    let measured = false
    let lastPaint = 0
    const touch = { id: -1, x: 0, y: 0, axis: '', start: 0, distance: 1, sideways: false }
    let touchPosition = 0
    const introShare = 0.12
    const previousOverflow = document.documentElement.style.overflow
    if (mobile) {
      document.documentElement.classList.add('melt-touch')
      document.documentElement.style.overflow = 'hidden'
    }
    let raf = 0
    let lastTs = 0
    let lastPublished = -1
    let lastCenter = -1
    let shown = false
    setReady(false)
    delete canvas.dataset.loadError
    const restoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    const decode = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`Frame request failed: ${response.status}`)
      return createImageBitmap(await response.blob())
    }
    const wake = () => {
      if (!stopped && !pausedRef.current && !document.hidden && !raf) raf = requestAnimationFrame(tick)
    }
    const desiredDetail = () => {
      if (!tier) return []
      const center = Math.floor(current * (tier.count - 1))
      const landing = Math.floor(target * (tier.count - 1))
      const direction = target >= current ? 1 : -1
      const nearby = [center, center + 1, center - 1, landing, landing + 1]
      for (let n = 2; n <= 7; n++) nearby.push(center + n * direction, center - n * direction)
      // Limit the desired set BEFORE checking the cache. Otherwise one frame
      // can evict another desired frame and start an endless fetch/decode loop.
      return [...new Set(nearby)].filter(i => i >= 0 && i < tier!.count && !keys.has(i)).slice(0, detailLimit)
    }
    const remember = (i: number, bitmap: ImageBitmap) => {
      if (stopped) { bitmap.close(); return }
      frames.get(i)?.close()
      frames.set(i, bitmap)
      const wanted = desiredDetail()
      const priority = (n: number) => { const rank = wanted.indexOf(n); return rank < 0 ? Infinity : rank }
      const detail = [...frames.keys()].filter((n) => !keys.has(n))
        .sort((a, b) => priority(a) - priority(b))
      for (const n of detail.slice(detailLimit)) {
        frames.get(n)?.close()
        frames.delete(n)
      }
      sorted = [...frames.keys()].sort((a, b) => a - b)
      canvas.dataset.cachedFrames = String(frames.size)
      canvas.dataset.detailFrames = String(Math.min(detail.length, detailLimit))
      canvas.dataset.keyframes = String(sorted.filter((n) => keys.has(n)).length)
      wake()
    }

    const pump = () => {
      if (stopped || !tier || document.hidden) return
      const pos = current * (tier.count - 1)
      const goal = target * (tier.count - 1)
      const step = tier.keyframes.step
      const wanted = (i: number) => i >= 0 && i < tier!.count && !frames.has(i) && !pending.has(i) && !failed.has(i)
      // First cover both sides of the current and intended positions. Then
      // complete the full timeline in the background, at the same resolution.
      const brackets = [Math.floor(pos / step) * step, Math.ceil(pos / step) * step,
        Math.floor(goal / step) * step, Math.min(Math.ceil(goal / step) * step, tier.count - 1)]
      // Cover the whole timeline early, then fill it in. A slow connection
      // must not spend every request loading frames behind a moving finger.
      const keyList = [...keys]
      const coverage: number[] = [keyList[0], keyList[keyList.length - 1]]
      const ranges = [[0, keyList.length - 1]]
      while (ranges.length) {
        const [lo, hi] = ranges.shift()!
        if (hi - lo <= 1) continue
        const mid = (lo + hi) >>> 1
        coverage.push(keyList[mid])
        ranges.push([lo, mid], [mid, hi])
      }
      const keyQueue = [...new Set([...brackets, ...coverage])].filter((i) => keys.has(i) && wanted(i))
      const detailQueue = desiredDetail().filter(wanted)
      let keyPending = [...pending].filter((i) => keys.has(i)).length
      let detailPending = pending.size - keyPending
      while (pending.size < 6) {
        let i: number | undefined
        if (keyQueue.length && keyPending < 4) {
          i = keyQueue.shift()
          keyPending++
        } else if (detailQueue.length && detailPending < (keyQueue.length || keyPending ? 2 : 6)) {
          i = detailQueue.shift()
          detailPending++
        }
        if (i === undefined) break
        const index = i
        pending.add(index)
        const file = `f${String(index).padStart(3, '0')}`
        const url = `/frames/${tier.dir}/${file}.${tier.extension}`
        void decode(url)
          .then((bitmap) => remember(index, bitmap))
          .catch(() => { if (!stopped) failed.add(index) })
          .finally(() => { pending.delete(index); pump() })
      }
    }

    const draw = () => {
      if (!tier || !sorted.length || !canvas.width || !canvas.height) return
      if (current === 0 && !frames.has(0)) return
      const pos = current * (tier.count - 1)
      // Find native-resolution neighbors. They need not be consecutive: a
      // missing exact frame changes temporal sampling, never spatial quality.
      let left = 0
      let right = sorted.length
      while (left < right) {
        const middle = (left + right) >>> 1
        if (sorted[middle] < pos) left = middle + 1
        else right = middle
      }
      const hi = sorted[Math.min(left, sorted.length - 1)]
      const lo = sorted[hi > pos ? Math.max(0, left - 1) : Math.min(left, sorted.length - 1)]
      const a = frames.get(lo)!
      const b = frames.get(hi)!
      const mix = hi === lo ? 0 : clamp01((pos - lo) / (hi - lo))
      const scale = Math.max(canvas.width / a.width, canvas.height / a.height)
      const dw = a.width * scale
      const dh = a.height * scale
      const dx = (canvas.width - dw) / 2
      const dy = (canvas.height - dh) / 2
      ctx.globalAlpha = 1
      ctx.drawImage(a, dx, dy, dw, dh)
      if (mix > 0) {
        ctx.globalAlpha = mix
        ctx.drawImage(b, dx, dy, dw, dh)
        ctx.globalAlpha = 1
      }
      if (!shown) { shown = true; setReady(true) }
      canvas.dataset.sourceWidth = String(Math.min(a.width, b.width))
      canvas.dataset.frameGap = String(hi - lo)
      canvas.dataset.framePosition = (lo + (hi - lo) * mix).toFixed(2)
    }

    function tick(ts: number) {
      raf = 0
      if (pausedRef.current || document.hidden) { lastTs = 0; return }
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60
      lastTs = ts
      const difference = (target - current) * (1 - Math.exp(-dt / (mobile ? 0.075 : 0.11)))
      // Touch momentum never skips the film in a single fling. Rendering keeps
      // its own clock instead of following Safari's viewport/scroll changes.
      const step = mobile ? Math.max(-dt * 0.18, Math.min(dt * 0.18, difference)) : difference
      current = reduced ? target : current + step
      if (mobile && touch.id !== -1 && current >= 1) current = 0.999
      if (Math.abs(current - target) < 0.0005 && !(mobile && touch.id !== -1 && target === 1)) current = target
      introCurrent = reduced ? introTarget : introCurrent + (introTarget - introCurrent) * (1 - Math.exp(-dt / 0.11))
      if (Math.abs(introCurrent - introTarget) < 0.0005) introCurrent = introTarget
      const settled = current === target && introCurrent === introTarget
      // High-refresh phones do not need to composite two large bitmaps 120
      // times per second for a 30 fps source. Always publish the final frame.
      if (!mobile || ts - lastPaint >= 1000 / 60 - 1 || settled) {
        lastPaint = ts
        setIntroProgress(introCurrent)
        draw()
        canvas!.dataset.introProgress = introCurrent.toFixed(4)
        canvas!.dataset.progress = current.toFixed(4)
        if (current !== lastPublished) { lastPublished = current; setProgress(current) }
      }
      const center = Math.round(current * ((tier?.count ?? 1) - 1))
      if (center !== lastCenter) { lastCenter = center; pump() }
      if (current !== target || introCurrent !== introTarget) wake()
    }
    const track = () => ({
      intro: window.innerHeight * 0.9,
      max: Math.max(1, document.documentElement.scrollHeight - window.innerHeight),
    })
    const measure = () => {
      if (pausedRef.current || mobile) return
      const { intro, max } = track()
      introTarget = clamp01(window.scrollY / intro)
      target = clamp01((window.scrollY - intro) / Math.max(1, max - intro))
      wake()
    }
    const restorePosition = () => {
      if (mobile) return
      const { intro, max } = track()
      window.scrollTo(0, introTarget < 1 ? introTarget * intro : intro + target * (max - intro))
    }
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      const scale = Math.min(dpr, 2000 / Math.max(canvas.clientWidth, canvas.clientHeight))
      const width = Math.max(1, Math.round(canvas.clientWidth * scale))
      const height = Math.max(1, Math.round(canvas.clientHeight * scale))
      if (canvas.width === width && canvas.height === height && measured) return
      canvas.width = width
      canvas.height = height
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      if (measured) restorePosition()
      else { measured = true; measure() }
      draw()
      wake()
    }
    syncRef.current = () => {
      lastTs = 0
      touch.id = -1
      if (!pausedRef.current) { restorePosition(); wake(); pump() }
    }
    const setTouchPosition = (position: number) => {
      touchPosition = clamp01(position)
      introTarget = clamp01(touchPosition / introShare)
      target = clamp01((touchPosition - introShare) / (1 - introShare))
      wake()
      pump()
    }
    const touchStart = (event: TouchEvent) => {
      if (!mobile || pausedRef.current || event.touches.length !== 1) return
      if (event.target instanceof Element && event.target.closest('button, a')) return
      const finger = event.touches[0]
      touch.id = finger.identifier
      touch.x = finger.clientX
      touch.y = finger.clientY
      touch.axis = ''
      touch.sideways = mobile && upright.matches
      touch.start = touchPosition
    }
    const touchMove = (event: TouchEvent) => {
      if (touch.id === -1 || pausedRef.current || event.touches.length !== 1) return
      const finger = [...event.touches].find(finger => finger.identifier === touch.id)
      if (!finger) return
      // An upright phone shows the stage turned a quarter turn, and the hand
      // turns with it: the swipe that reads as upward then runs toward the
      // device's right edge, the opposite of the x axis held in landscape.
      const dx = (touch.x - finger.clientX) * (touch.sideways ? -1 : 1)
      const dy = touch.y - finger.clientY
      if (!touch.axis && Math.max(Math.abs(dx), Math.abs(dy)) < 5) return
      if (!touch.axis) {
        touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        touch.distance = touch.axis === 'x' ? Math.max(600, innerWidth * 1.05) : Math.max(480, innerHeight * 1.8)
      }
      event.preventDefault()
      setTouchPosition(touch.start + (touch.axis === 'x' ? dx : dy) / touch.distance)
    }
    const touchEnd = () => { touch.id = -1; wake() }
    const wheel = (event: WheelEvent) => {
      if (!mobile || pausedRef.current || event.ctrlKey) return
      event.preventDefault()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      setTouchPosition(touchPosition + delta * (event.deltaMode === 1 ? 16 : 1) / Math.max(600, innerHeight * 1.8))
    }
    const keyboard = (event: KeyboardEvent) => {
      if (!mobile || pausedRef.current || (event.target instanceof Element && event.target.closest('button, a, input'))) return
      const direction = ['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key) ? 1
        : ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 0
      if (direction) { event.preventDefault(); setTouchPosition(touchPosition + direction * 0.15) }
    }
    const surface = canvas.closest<HTMLElement>('.viewport')!
    surface.addEventListener('touchstart', touchStart, { passive: true })
    surface.addEventListener('touchmove', touchMove, { passive: false })
    surface.addEventListener('touchend', touchEnd)
    surface.addEventListener('touchcancel', touchEnd)
    surface.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', keyboard)
    const visibility = () => { lastTs = 0; if (!document.hidden) { measure(); pump() } }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    resize()

    void (async () => {
      const response = await fetch(manifestUrl, { signal: controller.signal })
      if (!response.ok) throw new Error('Frame manifest unavailable')
      const manifest: Manifest = await response.json()
      if (stopped) return
      const selected = manifest[variant] ?? Object.values(manifest)[0]
      tier = mobile ? selected.mobile : selected.desktop
      canvas.dataset.tier = tier.dir
      for (let i = 0; i < tier.count; i += tier.keyframes.step) keys.add(i)
      keys.add(tier.count - 1)
      canvas.dataset.totalKeyframes = String(keys.size)
      // Reuse the native-resolution poster already requested by HTML. It is
      // drawable immediately; no bootstrap thumbnail or loading screen exists.
      pending.add(0)
      const poster = new Image()
      poster.decoding = 'async'
      poster.src = `/frames/${tier.dir}/f000.${tier.extension}`
      void poster.decode().then(() => createImageBitmap(poster))
        .then((bitmap) => remember(0, bitmap))
        .catch(() => {})
        .finally(() => { pending.delete(0); pump() })
      pump()
    })().catch(() => { if (!stopped) canvas.dataset.loadError = 'true' })

    return () => {
      stopped = true
      syncRef.current = () => {}
      controller.abort()
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      surface.removeEventListener('touchstart', touchStart)
      surface.removeEventListener('touchmove', touchMove)
      surface.removeEventListener('touchend', touchEnd)
      surface.removeEventListener('touchcancel', touchEnd)
      surface.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', keyboard)
      if (mobile) {
        document.documentElement.classList.remove('melt-touch')
        document.documentElement.style.overflow = previousOverflow
      }
      history.scrollRestoration = restoration
      frames.forEach((bitmap) => bitmap.close())
      frames.clear()
    }
  }, [manifestUrl, variant])

  return { canvasRef, progress, introProgress, ready }
}
