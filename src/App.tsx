import { useCallback, useEffect, useRef, useState } from 'react'
import { useMeltScrub } from './useMeltScrub'
import { useMeltAudio } from './useMeltAudio'
import { Info } from './Info'
import { SoundToggle } from './SoundToggle'

function Teaser({ onComplete, exiting }: { onComplete: () => void; exiting: boolean }) {
  const { canvasRef, progress, introProgress, ready } = useMeltScrub('/frames/manifest.json', 'hero')
  const { soundOn, soundPlaying, toggleSound } = useMeltAudio(progress, !exiting && introProgress >= 0.99, '/audio/hero-v3.m4a')
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
        <div className="film">
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
        </div>
        <SoundToggle on={soundOn} playing={soundPlaying} onToggle={toggleSound} />

        <section className="melt-intro" aria-hidden={introProgress >= 1} style={{ opacity: 1 - introProgress, visibility: introProgress >= 1 ? 'hidden' : 'visible' }}>
          <img className="intro-background" src="/brand/reveal-background.webp" alt="" fetchPriority="high" />
          <h1 className="intro-content">
            <img className="intro-prompt" src="/brand/reveal-prompt.svg" alt="Scroll To Melt" />
          </h1>
        </section>

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
