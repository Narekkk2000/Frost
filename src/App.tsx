import { useCallback, useEffect, useRef, useState } from 'react'
import { useMeltScrub } from './useMeltScrub'
import { useMeltAudio } from './useMeltAudio'
import { Info } from './Info'
import { SoundToggle } from './SoundToggle'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ramp = (p: number, from: number, to: number) => clamp01((p - from) / (to - from))

/** where the logo's drip line sits inside the frame, per frame set */
const ANCHOR = {
  desktop: { aspect: 1100 / 614, y: 0.83 },
  mobile: { aspect: 540 / 960, y: 0.66 },
}

/**
 * Screen-space Y of the point just under the logo. The canvas is cover-fit, so
 * the logo drifts with the viewport — this repeats the same fit maths to keep
 * the scroll instruction pinned under it on any screen.
 */
function useLogoAnchor() {
  const [y, setY] = useState(0)
  useEffect(() => {
    const measure = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const { aspect, y: fy } = vw <= 820 ? ANCHOR.mobile : ANCHOR.desktop
      const drawnHeight = Math.max(vh, vw / aspect)
      const top = (vh - drawnHeight) / 2
      setY(Math.min(top + fy * drawnHeight, vh - 132))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return y
}

function Teaser({ onComplete, exiting }: { onComplete: () => void; exiting: boolean }) {
  const { canvasRef, progress, ready } = useMeltScrub('/frames/manifest.json', 'meltdown')
  const { soundOn, soundPlaying, toggleSound } = useMeltAudio(progress)
  const anchorY = useLogoAnchor()
  const logoPreloaded = useRef(false)
  const completed = useRef(false)

  useEffect(() => {
    if (progress < 0.98) completed.current = false
    if (progress >= 1 && !exiting && !completed.current) {
      completed.current = true
      onComplete()
    }
    if (progress > 0.7 && !logoPreloaded.current) {
      logoPreloaded.current = true
      const logo = new Image()
      logo.src = '/brand/frost-logo.png'
    }
  }, [progress, exiting, onComplete])

  return (
    <main className={`stage${exiting ? ' stage--exiting' : ''}`} inert={exiting} aria-hidden={exiting}>
      <div className="viewport">
        <picture className="ice-poster" aria-hidden="true">
          <source media="(max-width: 820px)" srcSet="/frames/meltdown/m/f000.jpg" />
          <img src="/frames/meltdown/d/f000.jpg" alt="" fetchPriority="high" />
        </picture>
        <canvas
          ref={canvasRef}
          className="ice"
          style={{ opacity: ready ? 1 : 0 }}
          aria-hidden="true"
        />
        <SoundToggle on={soundOn} playing={soundPlaying} onToggle={toggleSound} />

        <div className="scroll-cue" style={{ top: `${anchorY}px`, opacity: 1 - ramp(progress, 0.88, 1) }}>
          <span>Scroll to melt</span>
          <svg className="scroll-cue-icon" viewBox="0 0 24 32" width="24" height="32" fill="none" aria-hidden="true">
            <path d="M12 2C12 2 7 8.1 7 11a5 5 0 0 0 10 0C17 8.1 12 2 12 2Z" fill="currentColor" />
            <path d="m7 24 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="meter" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
  )
}

/** The incoming page stays mounted as the crossfade becomes the active route. */
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  const [revealing, setRevealing] = useState(false)
  const onInfo = hash.startsWith('#/info')
  const beginReveal = useCallback(() => setRevealing(true), [])

  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash)
      setRevealing(false)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!revealing || onInfo) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => { window.location.hash = '/info' }, reduced ? 0 : 900)
    return () => clearTimeout(timer)
  }, [revealing, onInfo])

  return (
    <div className="experience">
      {!onInfo && <Teaser key="teaser" onComplete={beginReveal} exiting={revealing} />}
      {(onInfo || revealing) && (
        <div key="info" inert={!onInfo} aria-hidden={!onInfo} className={`info-page${onInfo ? '' : ' info-page--entering'}`}>
          <Info active={onInfo} />
        </div>
      )}
    </div>
  )
}
