import { useEffect, useRef, useState } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
type Tier = { count: number; dir: string; keyframes: { step: number; directory: string } }
type Manifest = Record<string, { desktop: Tier; mobile: Tier }>

/**
 * Every drawable image has the original source resolution. A small, permanent
 * set of full-resolution keyframes spans the timeline; a bounded detail cache
 * fills in nearby frames. Fast scrolling blends the surrounding sharp images,
 * never an enlarged thumbnail, and never waits for the entire sequence.
 */
export function useMeltScrub(manifestUrl: string, variant: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)

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
    const mobile = matchMedia('(max-width: 820px)').matches
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const detailLimit = mobile ? 16 : 18
    let tier: Tier | undefined
    let stopped = false
    let target = 0
    let current = 0
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
      if (!stopped && !document.hidden && !raf) raf = requestAnimationFrame(tick)
    }
    const remember = (i: number, bitmap: ImageBitmap) => {
      if (stopped) { bitmap.close(); return }
      frames.get(i)?.close()
      frames.set(i, bitmap)
      const center = current * (tier!.count - 1)
      const goal = target * (tier!.count - 1)
      const distance = (n: number) => Math.min(Math.abs(n - center), Math.abs(n - goal) + 8)
      const detail = [...frames.keys()].filter((n) => !keys.has(n))
        .sort((a, b) => distance(a) - distance(b))
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
      const center = Math.floor(pos)
      const landing = Math.floor(goal)
      const step = tier.keyframes.step
      const wanted = (i: number) => i >= 0 && i < tier!.count && !frames.has(i) && !pending.has(i) && !failed.has(i)
      // First cover both sides of the current and intended positions. Then
      // complete the full timeline in the background, at the same resolution.
      const brackets = [Math.floor(pos / step) * step, Math.ceil(pos / step) * step,
        Math.floor(goal / step) * step, Math.min(Math.ceil(goal / step) * step, tier.count - 1)]
      const remainingKeys = [...keys].sort((a, b) => Math.abs(a - pos) - Math.abs(b - pos))
      const keyQueue = [...new Set([...brackets, ...remainingKeys])].filter((i) => keys.has(i) && wanted(i))
      const nearby = [center, center + 1, center - 1, landing, landing + 1]
      const direction = target >= current ? 1 : -1
      for (let n = 2; n <= 7; n++) nearby.push(center + n * direction, center - n * direction)
      const detailQueue = [...new Set(nearby)].filter((i) => !keys.has(i) && wanted(i))
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
        const original = `/frames/${tier.dir}/${file}.jpg`
        const isKey = keys.has(index) && index !== 0
        const url = isKey ? `/frames/${tier.dir}/${tier.keyframes.directory}/${file}.webp` : original
        void decode(url)
          .catch((error) => {
            if (!isKey || stopped) throw error
            return decode(original)
          })
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
    }

    function tick(ts: number) {
      raf = 0
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60
      lastTs = ts
      current = reduced ? target : current + (target - current) * (1 - Math.exp(-dt / 0.11))
      if (Math.abs(current - target) < 0.0005) current = target
      draw()
      canvas!.dataset.progress = current.toFixed(4)
      if (current !== lastPublished) { lastPublished = current; setProgress(current) }
      const center = Math.round(current * ((tier?.count ?? 1) - 1))
      if (center !== lastCenter) { lastCenter = center; pump() }
      if (current !== target) wake()
    }
    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      target = max > 0 ? clamp01(window.scrollY / max) : 0
      wake()
    }
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      const scale = Math.min(dpr, 2000 / Math.max(canvas.clientWidth, canvas.clientHeight))
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale))
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      measure()
    }
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
      poster.src = `/frames/${tier.dir}/f000.jpg`
      void poster.decode().then(() => createImageBitmap(poster))
        .then((bitmap) => remember(0, bitmap))
        .catch(() => {})
        .finally(() => { pending.delete(0); pump() })
      pump()
    })().catch(() => { if (!stopped) canvas.dataset.loadError = 'true' })

    return () => {
      stopped = true
      controller.abort()
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      history.scrollRestoration = restoration
      frames.forEach((bitmap) => bitmap.close())
      frames.clear()
    }
  }, [manifestUrl, variant])

  return { canvasRef, progress, ready }
}
