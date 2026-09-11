import { useCallback, useEffect, useRef, useState } from 'react'

/** Scrub the recording itself in overlapping, gently faded slices. No generated sound. */
export function useMeltAudio(progress: number, active: boolean, source: string) {
  const [soundOn, setSoundOn] = useState(true)
  const [soundPlaying, setSoundPlaying] = useState(false)
  const enabled = useRef(true)
  const state = useRef({ progress, active, movedAt: 0 })
  if (Math.abs(state.current.progress - progress) > 0.0001) state.current.movedAt = performance.now()
  state.current.progress = progress
  state.current.active = active
  const control = useRef<{ unlock: () => void; silence: () => void } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let context: AudioContext | undefined
    let buffer: AudioBuffer | undefined
    let bytes: ArrayBuffer | undefined
    let decoding = false
    let playing = false
    const slices = new Map<AudioBufferSourceNode, GainNode>()
    const publish = (value: boolean) => {
      if (playing !== value && !disposed) { playing = value; setSoundPlaying(value) }
    }
    const silence = () => {
      for (const [slice, gain] of slices) {
        // Muting, completion, and rotation must stop every scheduled slice.
        gain.gain.cancelScheduledValues(0)
        gain.gain.value = 0
        slice.stop()
        slice.disconnect()
        gain.disconnect()
      }
      slices.clear()
      publish(false)
    }
    const decode = async () => {
      if (!context || !bytes || decoding || buffer) return
      decoding = true
      try { buffer = await context.decodeAudioData(bytes.slice(0)) }
      catch { /* Keep the visual experience usable if audio decoding is unavailable. */ }
      finally { decoding = false }
    }
    const unlock = () => {
      if (disposed || !enabled.current) return
      context ??= new AudioContext()
      if (context.state !== 'running' && context.state !== 'closed') void context.resume().catch(() => {})
      void decode()
    }
    control.current = { unlock, silence }
    void fetch(source, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Soundtrack unavailable')
      return response.arrayBuffer()
    }).then(data => { if (!disposed) { bytes = data; void decode() } }).catch(() => {})

    const gesture = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-sound-toggle]')) return
      unlock()
    }
    for (const type of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(type, gesture, { passive: true })
    // Succeeds immediately when the browser already permits sound. Otherwise a
    // trusted tap/key resumes the same context; the user's preference stays on.
    unlock()
    const interval = window.setInterval(() => {
      const { progress: position, active: canPlay, movedAt } = state.current
      if (!enabled.current || !canPlay || document.hidden || position <= 0 || position >= 1 || performance.now() - movedAt > 180) {
        silence()
        return
      }
      if (!context || context.state !== 'running' || !buffer) { publish(false); return }
      const offset = position * buffer.duration
      const length = Math.min(0.18, buffer.duration - offset)
      if (length < 0.015) { silence(); return }
      const slice = context.createBufferSource()
      const gain = context.createGain()
      slice.buffer = buffer
      slice.connect(gain)
      gain.connect(context.destination)
      const now = context.currentTime
      // 90 ms spacing + 180 ms triangular envelopes gives a continuous level.
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.85, now + length / 2)
      gain.gain.linearRampToValueAtTime(0, now + length)
      slices.set(slice, gain)
      slice.onended = () => { slices.delete(slice); slice.disconnect(); gain.disconnect() }
      slice.start(now, offset, length)
      publish(true)
    }, 90)
    const visibility = () => { if (document.hidden) silence() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      controller.abort()
      clearInterval(interval)
      silence()
      control.current = null
      for (const type of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(type, gesture)
      document.removeEventListener('visibilitychange', visibility)
      if (context && context.state !== 'closed') void context.close()
    }
  }, [source])

  useEffect(() => {
    if (!active || progress >= 1) control.current?.silence()
    if (progress >= 1) { enabled.current = false; setSoundOn(false) }
  }, [active, progress])

  const toggleSound = useCallback(() => {
    enabled.current = !enabled.current
    setSoundOn(enabled.current)
    if (enabled.current) control.current?.unlock()
    else control.current?.silence()
  }, [])

  return { soundOn, soundPlaying, toggleSound }
}
