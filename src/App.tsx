import type { CSSProperties } from 'react'
import { useState } from 'react'
import { useMeltScrub } from './useMeltScrub'

/** the two melt variants, each a tab (ids match public/frames/manifest.json) */
const VARIANTS = [
  { id: 'deepfreeze', label: 'Deep Freeze' },
  { id: 'meltdown', label: 'Meltdown' },
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** split a line into staggered words so each can "defrost" in on its own delay */
const words = (text: string) =>
  text.split(' ').flatMap((w, i, arr) => {
    const span = (
      <span className="word" style={{ '--wi': i } as CSSProperties} key={i}>
        {w}
      </span>
    )
    return i < arr.length - 1 ? [span, ' '] : [span]
  })

/** 0 → 1 as progress moves from `from` to `to` */
const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from))

/** trapezoid visibility: fades in over [a, b], holds, fades out over [c, d] */
const between = (p: number, a: number, b: number, c: number, d: number) =>
  ramp(p, a, b) * (1 - ramp(p, c, d))

/** slow upward drift across a phrase's scroll window */
const drift = (p: number, a: number, d: number) => (0.5 - ramp(p, a, d)) * 48

export default function App() {
  const [variant, setVariant] = useState(VARIANTS[0].id)
  const { canvasRef, progress, ready } = useMeltScrub('/frames/manifest.json', variant)

  const celsius = -18 + 42 * progress
  const temp = `${celsius < 0 ? '−' : '+'}${Math.abs(celsius).toFixed(1)}°C`
  const mass = `${String(Math.round((1 - progress) * 100)).padStart(3, '0')}%`
  const tempColor = `color-mix(in oklab, var(--ice-blue) ${Math.round((1 - progress) * 100)}%, var(--ember))`

  return (
    <main className="stage">
      <div className="viewport">
        <canvas
          ref={canvasRef}
          className="ice"
          style={{ opacity: ready ? 1 : 0 }}
          aria-hidden="true"
        />
        <div className="scrim" />

        <header className="hud hud-top">
          <span className="mono">Frost — field notes</span>
          <span className="mono temp" style={{ color: tempColor }}>
            {temp}
          </span>
        </header>

        <nav className="tabs" aria-label="Melt variant">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`tab mono${variant === v.id ? ' active' : ''}`}
              aria-pressed={variant === v.id}
              onClick={() => setVariant(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <section
          className="phrase"
          style={{
            opacity: between(progress, -1, 0, 0.14, 0.22),
            transform: `translateY(${drift(progress, -0.22, 0.22)}px)`,
          }}
        >
          <h1 className={`headline${progress <= 0.22 ? ' reveal' : ''}`}>
            {words('The legend is defrosting.')}
          </h1>
        </section>

        <section
          className="phrase"
          style={{
            opacity: between(progress, 0.34, 0.42, 0.6, 0.68),
            transform: `translateY(${drift(progress, 0.34, 0.68)}px)`,
          }}
        >
          <p className={`line${progress >= 0.34 && progress <= 0.68 ? ' reveal' : ''}`}>
            {words('The ultimate cannabis delivery experience is coming.')}
          </p>
        </section>

        <section
          className="phrase"
          style={{
            opacity: between(progress, 0.82, 0.92, 2, 3),
            transform: `translateY(${drift(progress, 0.82, 1.02)}px)`,
          }}
        >
          <p className={`headline${progress >= 0.82 ? ' reveal' : ''}`}>
            {words('Stay tuned.')}
          </p>
        </section>

        <footer className="hud hud-bottom">
          <span className="mono">specimen № 4530 — mass {mass}</span>
          <span className="mono hint" style={{ opacity: 1 - ramp(progress, 0.01, 0.06) }}>
            scroll to melt ↓
          </span>
        </footer>

        <div className="meter" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
  )
}
