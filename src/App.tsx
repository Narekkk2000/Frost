import { useEffect, useState } from 'react'
import { useMeltScrub } from './useMeltScrub'
import { useMeltAudio } from './useMeltAudio'
import { Info } from './Info'
import { LiquidButton } from './LiquidButton'
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
 * the CTA pinned under it on any screen.
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

function Teaser() {
  const { canvasRef, progress, ready } = useMeltScrub('/frames/manifest.json', 'meltdown')
  const { soundOn, toggleSound } = useMeltAudio(progress)
  const anchorY = useLogoAnchor()

  return (
    <main className="stage">
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
        <div className="scrim" />

        <LiquidButton melt={progress} top={anchorY} />

        <SoundToggle on={soundOn} onToggle={toggleSound} />

        <div className="scroll-cue" style={{ opacity: 1 - ramp(progress, 0.02, 0.09) }}>
          <span className="scroll-cue-drop" />
        </div>

        <div className="meter" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
  )
}

/** '#/info' → the content page, anything else → the teaser */
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onInfo = hash.startsWith('#/info')

  // the teaser is a 520vh scrub track, so always land at the top on a switch
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [onInfo])

  return onInfo ? <Info /> : <Teaser />
}
