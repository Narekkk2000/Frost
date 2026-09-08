/**
 * A tiny drip simulation, shared by the button and the page ceiling.
 *
 * Each drip hangs off a horizontal edge, lengthens as `flow` rises, and gathers
 * mass into a bead at its tip. Past a threshold the bead is heavier than the
 * neck can hold, so it pinches off into a free droplet and the drip snaps back —
 * which is the part that reads as real liquid and that no CSS keyframe can fake,
 * because the timing has to come out of accumulated mass rather than a clock.
 */

export type DripConfig = {
  count: number
  /** span the drips are spread across, in CSS px */
  width: number
  /** left edge of that span */
  x0: number
  /** y of the edge they hang from */
  originY: number
  /** longest a drip gets at full flow */
  maxLen: number
  /** radius at the root and at the tip */
  r1: number
  r2: number
  /** droplets are retired once they pass this y */
  bottom: number
  dropCap?: number
  seed?: number
}

export type DripField = {
  /** vec4 per drip: x, length, root radius, tip radius */
  drips: Float32Array
  /** vec3 per live droplet: x, y, radius */
  drops: Float32Array
  count: number
  dropCap: number
  liveDrops: number
  step(dt: number, flow: number): void
  setGeometry(g: Partial<Pick<DripConfig, 'width' | 'x0' | 'originY' | 'bottom'>>): void
}

/** deterministic layout — the drips should be in the same places every reload */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createDripField(cfg: DripConfig): DripField {
  const n = cfg.count
  const dropCap = cfg.dropCap ?? 8
  const rand = rng(cfg.seed ?? 0x5eed)

  let { width, x0, originY, bottom } = cfg

  // per-drip character: some run early and far, some barely weep
  const u = new Float32Array(n) // 0..1 position across the span
  const bias = new Float32Array(n)
  const rate = new Float32Array(n)
  const phase = new Float32Array(n)
  const len = new Float32Array(n)
  const mass = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    // even spacing with jitter keeps them shoulder to shoulder but not combed
    u[i] = (i + 0.5) / n + (rand() - 0.5) * (0.45 / n)
    bias[i] = 0.3 + rand() * 0.7
    rate[i] = 0.55 + rand() * 0.9
    phase[i] = rand() * Math.PI * 2
    mass[i] = rand() * 0.5
  }

  const drips = new Float32Array(n * 4)
  const drops = new Float32Array(dropCap * 3)
  const vel = new Float32Array(dropCap)
  const alive = new Uint8Array(dropCap)

  let t = 0
  const field: DripField = {
    drips,
    drops,
    count: n,
    dropCap,
    liveDrops: 0,
    setGeometry(g) {
      if (g.width !== undefined) width = g.width
      if (g.x0 !== undefined) x0 = g.x0
      if (g.originY !== undefined) originY = g.originY
      if (g.bottom !== undefined) bottom = g.bottom
    },
    step(dt, flow) {
      dt = Math.min(dt, 1 / 20) // a backgrounded tab shouldn't teleport the fluid
      t += dt
      const f = Math.min(1, Math.max(0, flow))

      for (let i = 0; i < n; i++) {
        const x = x0 + u[i] * width
        // surface tension holds a little length back even when cold
        const wob = 1 + 0.09 * Math.sin(t * (0.7 + rate[i] * 0.5) + phase[i])
        const target = cfg.maxLen * bias[i] * f * f * wob
        len[i] += (target - len[i]) * Math.min(1, dt * (1.4 + rate[i]))

        // mass only gathers once there's actually something running
        mass[i] += dt * f * f * rate[i] * 0.5
        const bead = cfg.r2 * (1 + 1.7 * Math.min(mass[i], 1))

        drips[i * 4] = x
        drips[i * 4 + 1] = len[i]
        // the neck thins as the bead loads it up
        drips[i * 4 + 2] = cfg.r1 * (1 - 0.18 * Math.min(mass[i], 1))
        drips[i * 4 + 3] = bead

        if (mass[i] >= 1 && len[i] > cfg.maxLen * 0.3) {
          for (let d = 0; d < dropCap; d++) {
            if (alive[d]) continue
            alive[d] = 1
            drops[d * 3] = x
            drops[d * 3 + 1] = originY + len[i]
            drops[d * 3 + 2] = bead
            vel[d] = 18
            break
          }
          mass[i] = 0
          len[i] *= 0.52 // recoil
        }
      }

      let live = 0
      for (let d = 0; d < dropCap; d++) {
        if (!alive[d]) {
          drops[d * 3 + 2] = 0 // radius 0 = invisible to the shader
          continue
        }
        vel[d] += 1350 * dt
        drops[d * 3 + 1] += vel[d] * dt
        if (drops[d * 3 + 1] - drops[d * 3 + 2] > bottom) {
          alive[d] = 0
          drops[d * 3 + 2] = 0
        } else live++
      }
      field.liveDrops = live
    },
  }

  return field
}
