import { useCallback, useEffect, useRef, useState } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ramp = (p: number, a: number, b: number) => clamp01((p - a) / (b - a))
/** 1 at `center`, tapering off over `width` */
const bell = (p: number, center: number, width: number) => Math.exp(-(((p - center) / width) ** 2))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** tiny room impulse — just enough to sit the sound in a space */
function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
  }
  return buf
}

/**
 * Melting ice, scrubbed by the scroll.
 *
 * The drips are bubble resonances, not filtered noise. When a drop lands it
 * traps a pocket of air, and that cavity oscillates as a damped sinusoid whose
 * pitch *rises* as it collapses — that upward "plip" is the entire reason a
 * water drop sounds like a water drop. Noise bursts alone only ever give you a
 * tick. Running water is the same thing en masse: a dense swarm of tiny
 * bubbles, which is why hiss reads as radio static instead of a stream.
 *
 * The earlier version rang like a bell because it used a fixed, long decay.
 * Here the damping is the physical one, `d = 0.043f0 + 0.0014f0^1.5`, so decay
 * is tied to pitch: small bubbles are 10ms ticks and even the fattest is gone
 * inside 75ms. Nothing can sustain long enough to read as a note.
 */
function createEngine(onState: (running: boolean) => void) {
  const ctx = new AudioContext()

  const master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)

  // just enough room to place the drips; any longer and the tails smear into
  // one another and start sounding musical
  const room = ctx.createConvolver()
  room.buffer = impulse(ctx, 0.38, 3.0)
  const send = ctx.createGain()
  send.gain.value = 0.09
  send.connect(room)
  room.connect(master)

  const bus = ctx.createGain()
  bus.connect(master)
  bus.connect(send)

  const noise = noiseBuffer(ctx, 6)

  const src = (rate: number) => {
    const n = ctx.createBufferSource()
    n.buffer = noise
    n.loop = true
    n.playbackRate.value = rate
    return n
  }

  const filter = (type: BiquadFilterType, freq: number, q: number) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  /** looping noise bed shaped by one filter */
  const bed = (type: BiquadFilterType, freq: number, q: number) => {
    const n = src(1)
    const f = filter(type, freq, q)
    const g = ctx.createGain()
    g.gain.value = 0
    n.connect(f).connect(g).connect(bus)
    n.start()
    return { gain: g.gain, filter: f }
  }

  const air = bed('lowpass', 210, 0.6) // cold room tone, barely there
  // broadband splash sitting *under* the bubbles — glue, never the water itself
  const flow = bed('bandpass', 2300, 0.55)

  // slow wander so the stream never sits perfectly still
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.08
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 600
  lfo.connect(lfoDepth).connect(flow.filter.frequency)
  lfo.start()

  /**
   * One bubble. Pitch rises by ~σ·6.9 over its life (the cavity shrinking), and
   * the decay comes straight out of the radius, so it is physically incapable
   * of sustaining. Capped at 75ms because the lowest bubbles would otherwise
   * ring for a quarter of a second.
   */
  const bubble = (t: number, f0: number, amp: number) => {
    const damp = 0.043 * f0 + 0.0014 * f0 ** 1.5
    const dur = Math.min(0.075, 6.9 / damp)
    const sigma = rand(0.06, 0.13)
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(f0, t)
    osc.frequency.linearRampToValueAtTime(f0 * (1 + sigma * 6.9), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(amp, t + 0.0008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(bus)
    osc.start(t)
    osc.stop(t + dur + 0.01)
  }

  /** a short noise snap: ice giving way, or the impact in front of a bubble */
  const snap = (t: number, level: number, lo: number, hi: number, len: number) => {
    const dur = rand(len * 0.5, len)
    const n = src(rand(0.5, 1.7))
    const bp = filter('bandpass', rand(lo, hi), rand(1.0, 3.0))
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.0012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    n.connect(bp).connect(g).connect(bus)
    n.start(t)
    n.stop(t + dur + 0.02)
  }

  /**
   * A falling drop landing: the tick of the impact, then the cavity it opens
   * ringing down. `size` 0 → a fat slow drop (low, round), 1 → a fine spatter.
   */
  const drip = (t: number, level: number, size: number) => {
    snap(t, level * 0.45, 1800, 5200, 0.009)
    bubble(t + rand(0.0015, 0.005), rand(420, 900) + size * rand(500, 1600), level)
    // a drop often traps a second, smaller pocket a moment later
    if (Math.random() < 0.45) {
      bubble(t + rand(0.018, 0.055), rand(1400, 3200), level * 0.3)
    }
  }

  let enabled = false
  let suspendTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  ctx.onstatechange = () => onState(enabled && ctx.state === 'running')

  const STEP = 0.07
  let progress = 0
  let velocity = 0

  const timer = setInterval(() => {
    if (!enabled || ctx.state !== 'running' || progress >= 1) return
    const p = progress
    const now = ctx.currentTime
    const set = (param: AudioParam, v: number) => param.linearRampToValueAtTime(v, now + 0.2)

    /** fire `rate` events per second, spread randomly across this step */
    const schedule = (rate: number, fn: (t: number) => void) => {
      let n = Math.min(rate * STEP, 14)
      while (n > 0) {
        if (n >= 1 || Math.random() < n) fn(now + 0.03 + Math.random() * STEP)
        n -= 1
      }
    }

    // frozen solid is almost silent; the room only opens up as it goes
    set(air.gain, 0.014 + 0.012 * ramp(p, 0.25, 1))
    set(flow.gain, 0.018 * ramp(p, 0.5, 1) + 0.05 * velocity)

    // ice giving way, thickest while the block is actually breaking down
    schedule(30 * bell(p, 0.38, 0.3) + 190 * velocity, (t) =>
      snap(t, rand(0.006, 0.038), 600, 4200, 0.026),
    )

    // drips: rare and fat at first, then quick and fine, easing off once there
    // is little ice left to shed
    const dripRate = 7 * ramp(p, 0.12, 0.7) * (1 - 0.5 * ramp(p, 0.82, 1)) + 13 * velocity
    schedule(dripRate, (t) =>
      drip(t, rand(0.05, 0.13), clamp01(ramp(p, 0.1, 0.9) + rand(-0.3, 0.3))),
    )

    // and the stream it all collects into
    schedule(70 * ramp(p, 0.45, 1) + 130 * velocity, (t) =>
      bubble(t, rand(900, 4200), rand(0.004, 0.02)),
    )

    velocity *= 0.5
  }, STEP * 1000)

  let last = 0
  return {
    setProgress(p: number) {
      velocity = Math.min(0.06, Math.abs(p - last))
      last = p
      progress = p
    },
    setEnabled(on: boolean) {
      if (disposed) return
      enabled = on
      clearTimeout(suspendTimer)
      // resume() runs synchronously in the gesture handler, never in a React
      // effect after the browser's transient activation has expired.
      if (on) {
        void ctx.resume().then(() => {
          if (!disposed) onState(enabled && ctx.state === 'running')
        }).catch(() => { if (!disposed) onState(false) })
      }
      const t = ctx.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(master.gain.value, t)
      master.gain.linearRampToValueAtTime(on ? 0.85 : 0, t + 0.15)
      if (!on) {
        onState(false)
        suspendTimer = setTimeout(() => {
          if (!enabled && !disposed) void ctx.suspend().catch(() => {})
        }, 200)
      }
    },
    dispose() {
      disposed = true
      enabled = false
      clearTimeout(suspendTimer)
      clearInterval(timer)
      ctx.onstatechange = null
      void ctx.close().catch(() => {})
    },
  }
}

type Engine = ReturnType<typeof createEngine>

export function useMeltAudio(progress: number) {
  const engineRef = useRef<Engine | null>(null)
  const progressRef = useRef(progress)
  const requestedRef = useRef(false)
  const chosenRef = useRef(false)
  const [on, setOn] = useState(false)
  progressRef.current = progress

  const enable = useCallback((wanted: boolean) => {
    requestedRef.current = wanted && progressRef.current < 1
    if (!engineRef.current && requestedRef.current) {
      try { engineRef.current = createEngine(setOn) }
      catch { requestedRef.current = false; setOn(false); return }
    }
    engineRef.current?.setProgress(progressRef.current)
    engineRef.current?.setEnabled(requestedRef.current && !document.hidden)
  }, [])

  useEffect(() => {
    const gesture = (event: Event) => {
      // The sound button owns its click. Auto-enabling on its pointerdown
      // used to turn it on immediately before its click toggled it off again.
      if ((event.target as Element | null)?.closest?.('[data-sound-toggle]')) return
      if (event instanceof KeyboardEvent && (event.repeat || event.metaKey || event.ctrlKey || event.altKey)) return
      if (progressRef.current >= 1) return
      if (!chosenRef.current || requestedRef.current) {
        chosenRef.current = true
        enable(true)
      }
    }
    // Wheel is deliberately absent: it is not an audio-unlocking gesture.
    const events = ['pointerdown', 'keydown', 'touchend'] as const
    events.forEach((name) => window.addEventListener(name, gesture, { passive: true }))
    const visibility = () => engineRef.current?.setEnabled(requestedRef.current && !document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      events.forEach((name) => window.removeEventListener(name, gesture))
      document.removeEventListener('visibilitychange', visibility)
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [enable])

  useEffect(() => {
    engineRef.current?.setProgress(progress)
    if (progress >= 1) {
      chosenRef.current = true
      enable(false)
    }
  }, [progress, enable])

  const toggle = useCallback(() => {
    chosenRef.current = true
    // If the OS/browser suspended a requested sound, the visible off button
    // should retry playback on the first click.
    enable(!on)
  }, [enable, on])

  return { soundOn: on, toggleSound: toggle }
}
