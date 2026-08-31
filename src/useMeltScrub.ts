import { useEffect, useRef, useState } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

type Manifest = { count: number }

/**
 * Scroll-scrubbed melt using a pre-baked image sequence.
 *
 * The frames are rendered offline (see public/frames), so at runtime the page
 * only *loads pictures* — and the browser decodes images off the main thread
 * via `createImageBitmap`. That's the whole point: there's no video seeking and
 * no frame extraction on the main thread, so there is no load-time freeze /
 * "2fps" at any point. Rendering is the crossfade path that felt smooth: each
 * scroll position blends the two neighbouring frames into one dissolving image.
 */
export function useMeltScrub(manifestUrl: string) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Always open frozen at the top, even if the browser restored scroll.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    window.scrollTo(0, 0)

    let frames: (ImageBitmap | undefined)[] = []
    let loadedCount = 0 // frames are loaded in order, so this is contiguous from 0
    let total = 0
    let target = 0
    let current = 0
    let raf = 0
    let lastTs = 0
    let lastDrawn = -1
    let cancelled = false
    let canvasShown = false

    const measure = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      target = max > 0 ? clamp01(window.scrollY / max) : 0
    }

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (w === canvas.width && h === canvas.height) return
      canvas.width = w
      canvas.height = h
      lastDrawn = -1 // resize cleared the buffer
    }

    /** cover-fit draw of the frame pair around fractional position `pos`, blended */
    const drawAt = (pos: number) => {
      if (loadedCount === 0 || canvas.width === 0) return
      // clamp to what's loaded so a fast first scroll holds the newest frame
      // instead of flashing blank, then fills in as more arrive
      let i = Math.floor(pos)
      if (i > loadedCount - 1) i = loadedCount - 1
      if (i < 0) i = 0
      const a = frames[i]
      if (!a) return
      const b = frames[Math.min(i + 1, loadedCount - 1)] ?? a
      const mix = clamp01(pos - i)

      const scale = Math.max(canvas.width / a.width, canvas.height / a.height)
      const dw = a.width * scale
      const dh = a.height * scale
      const dx = (canvas.width - dw) / 2
      const dy = (canvas.height - dh) / 2
      ctx.globalAlpha = 1
      ctx.drawImage(a, dx, dy, dw, dh)
      if (b !== a && mix > 0.001) {
        ctx.globalAlpha = mix
        ctx.drawImage(b, dx, dy, dw, dh)
        ctx.globalAlpha = 1
      }
    }

    // Frame-rate-independent easing, so a brief hitch never leaves the melt
    // crawling behind the scroll.
    const TAU = 0.14

    const tick = (ts: number) => {
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60
      lastTs = ts
      current += (target - current) * (1 - Math.exp(-dt / TAU))
      if (Math.abs(target - current) < 0.0005) current = target

      if (total > 1) {
        const pos = current * (total - 1)
        if (Math.abs(pos - lastDrawn) > 0.002) {
          drawAt(pos)
          lastDrawn = pos
        }
      }
      setProgress(current)
      raf = requestAnimationFrame(tick)
    }

    const onResize = () => {
      measure()
      resizeCanvas()
    }

    measure()
    resizeCanvas()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(canvas)
    raf = requestAnimationFrame(tick)

    const frameUrl = (i: number) => `/frames/f${String(i).padStart(3, '0')}.jpg`

    // Load frames in order, several at a time. fetch + createImageBitmap both
    // run off the main thread, so this never blocks scrolling or painting.
    const run = async () => {
      const manifest: Manifest = await fetch(manifestUrl).then((r) => r.json())
      if (cancelled) return
      total = manifest.count
      frames = new Array(total)

      let next = 0
      const worker = async () => {
        while (!cancelled && next < total) {
          const i = next++
          try {
            const blob = await fetch(frameUrl(i)).then((r) => r.blob())
            const bmp = await createImageBitmap(blob)
            if (cancelled) {
              bmp.close()
              return
            }
            frames[i] = bmp
            // contiguous because indices are handed out in order
            while (frames[loadedCount]) loadedCount++
            lastDrawn = -1
            canvas.dataset.frames = String(loadedCount)
            if (!canvasShown) {
              canvasShown = true
              setReady(true)
            }
          } catch {
            /* skip a bad frame; neighbours cover it */
          }
        }
      }
      const POOL = 8
      await Promise.all(Array.from({ length: POOL }, worker))
    }
    run().catch(() => {})

    return () => {
      cancelled = true
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      cancelAnimationFrame(raf)
      frames.forEach((f) => f?.close())
      frames = []
    }
  }, [manifestUrl])

  return { canvasRef, progress, ready }
}
