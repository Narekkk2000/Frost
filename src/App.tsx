import { useCallback, useEffect, useRef, useState } from 'react'
import { useMeltScrub } from './useMeltScrub'
import { useMeltAudio } from './useMeltAudio'
import { Info } from './Info'
import { SoundToggle } from './SoundToggle'

function usePortraitPhone() {
  const query = '(pointer: coarse) and (orientation: portrait)'
  const [portrait, setPortrait] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setPortrait(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return portrait
}

function DropArrow() {
  return <svg className="scroll-cue-icon" viewBox="0 0 24 32" width="24" height="32" fill="none" aria-hidden="true">
    <path d="M12 2C12 2 7 8.1 7 11a5 5 0 0 0 10 0C17 8.1 12 2 12 2Z" fill="currentColor" />
    <path d="m7 24 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function Teaser({ onComplete, exiting }: { onComplete: () => void; exiting: boolean }) {
  const portrait = usePortraitPhone()
  const { canvasRef, progress, introProgress, ready } = useMeltScrub('/frames/manifest.json', 'hero', portrait)
  const { soundOn, soundPlaying, toggleSound } = useMeltAudio(progress, !portrait && !exiting && introProgress >= 0.99, '/audio/hero-v3.m4a')
  useEffect(() => {
    if (!portrait) return
    const previous = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = previous }
  }, [portrait])
  const logoPreloaded = useRef(false)
  const completed = useRef(false)

  useEffect(() => {
    if (progress < 0.98) completed.current = false
    if (progress >= 1 && !portrait && !exiting && !completed.current) {
      completed.current = true
      onComplete()
    }
    if (progress > 0.7 && !logoPreloaded.current) {
      logoPreloaded.current = true
      const logo = new Image()
      logo.src = '/brand/frost-logo.png'
    }
  }, [progress, portrait, exiting, onComplete])

  return (
    <>
    <main className={`stage${exiting ? ' stage--exiting' : ''}`} inert={exiting || portrait} aria-hidden={exiting || portrait}>
      <div className="viewport">
        <picture className="ice-poster" aria-hidden="true">
          <source media="(pointer: coarse)" srcSet="/frames/hero-v3/m/f000.webp" />
          <img src="/frames/hero-v3/d/f000.webp" alt="" fetchPriority="high" />
        </picture>
        <canvas
          ref={canvasRef}
          className="ice"
          style={{ opacity: ready ? 1 : 0 }}
          aria-hidden="true"
        />
        <SoundToggle on={soundOn} playing={soundPlaying} onToggle={toggleSound} />

        <section className="melt-intro" aria-hidden={introProgress >= 1} style={{ opacity: 1 - introProgress, visibility: introProgress >= 1 ? 'hidden' : 'visible' }}>
          <div className="intro-content" style={{ transform: `translateY(${-introProgress * 40}px)` }}>
            <svg className="intro-logo" viewBox="450 1475 3270 1215" role="img" aria-label="Frost">
              <image href="/brand/frost-logo.png" width="4167" height="4167" />
            </svg>
            <h1>Scroll To Melt</h1>
            <DropArrow />
          </div>
        </section>

        <div className="meter" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </main>
    {portrait && <section className="rotate-prompt" role="dialog" aria-modal="true" aria-labelledby="rotate-title">
      <svg viewBox="0 0 80 80" width="80" height="80" fill="none" aria-hidden="true">
        <rect x="25" y="16" width="30" height="48" rx="6" stroke="currentColor" strokeWidth="2" transform="rotate(-25 40 40)" />
        <path d="M35 55h8M12 34a29 29 0 0 1 48-18m-1-9 2 10-10 1M68 46a29 29 0 0 1-48 18m1 9-2-10 10-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 id="rotate-title">Rotate your phone</h1>
      <p>Turn your phone sideways to {progress > 0 ? 'continue' : 'start'} the melt.</p>
    </section>}
    </>
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
