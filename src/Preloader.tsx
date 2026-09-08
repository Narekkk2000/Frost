import { useEffect, useRef, useState } from 'react'
import { createSketch, LIQUID_GLSL } from './gl'
import { createDripField } from './drips'

const MAX_DRIPS = 7
const MAX_DROPS = 10

const FRAG = `#version 300 es
${LIQUID_GLSL}
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uCube;    // cx, cy, halfW, halfH
uniform float uCubeR;
uniform vec4 uPuddle;  // cx, cy, halfW, halfH
uniform float uGlazeY; // everything below this on the cube is glazed
uniform float uP;
uniform vec4 uDrips[${MAX_DRIPS}];
uniform vec3 uDrops[${MAX_DROPS}];
out vec4 fragColor;

float dropField(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec3 c = uDrops[i];
    if (c.z <= 0.0) continue;
    vec2 q = p - c.xy;
    q.y *= 0.72;
    d = min(d, length(q) - c.z);
  }
  return d;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uRes.y - gl_FragCoord.y / uDpr);

  float dCube = sdRoundBox(p, uCube.xy, uCube.zw, uCubeR);
  // the glaze has run down and pooled on the underside, so it is the *lower*
  // part of the cube that is coated — which is where the drips can leave from
  float dGlaze = max(dCube, uGlazeY - p.y);

  for (int i = 0; i < ${MAX_DRIPS}; i++) {
    vec4 dr = uDrips[i];
    if (dr.y <= 0.5) continue;
    vec2 a = vec2(dr.x, uCube.y + uCube.w - 6.0);
    vec2 e = vec2(dr.x, uCube.y + uCube.w + dr.y);
    dGlaze = smin(dGlaze, sdCone(p, a, e, dr.z, dr.z * 0.42), 6.0);
    dGlaze = smin(dGlaze, length(p - e) - dr.w, 3.0);
  }

  float dPuddle = sdRoundBox(p, uPuddle.xy, uPuddle.zw, uPuddle.w);

  float dLiquid = smin(dGlaze, dropField(p), 2.5);
  dLiquid = smin(dLiquid, dPuddle, 9.0); // droplets fold into the puddle
  float d = min(dCube, dLiquid);

  float ct = clamp((p.y - (uCube.y - uCube.w)) / (2.0 * uCube.w), 0.0, 1.0);
  vec3 ice = mix(vec3(0.937, 0.976, 0.996), vec3(0.529, 0.776, 0.910), ct);
  float lt = clamp((p.y - uGlazeY) / 150.0, 0.0, 1.0);
  vec3 glaze = mix(vec3(0.949, 0.686, 0.812), vec3(0.831, 0.478, 0.655), lt);

  float pink = smoothstep(1.2, -1.2, dLiquid);
  vec3 base = mix(ice, glaze, pink);

  float radius = mix(uCube.w * 0.95, 7.5, pink);
  vec3 col = gel(d, base, radius, normalize(vec3(-0.40, -0.68, 0.60)));

  // the cube is frostiest while it is still whole
  float frost = (1.0 - uP) * smoothstep(2.0, -10.0, dCube);
  col = mix(col, mix(col, vec3(1.0), 0.5), frost);

  float aa = max(fwidth(d), 0.55);
  float a = 1.0 - smoothstep(-aa, aa, d);

  float ds = sdRoundBox(p - vec2(0.0, 9.0), uPuddle.xy, uPuddle.zw, uPuddle.w);
  float sh = smoothstep(24.0, -8.0, ds) * 0.30;

  fragColor = vec4(col * a + vec3(0.106, 0.239, 0.333) * sh * (1.0 - a), a + sh * (1.0 - a));
}
`

/**
 * Holds the visitor until the whole frame sequence is decoded, because the melt
 * is scrubbed off those frames — start scrolling at 5% loaded and the animation
 * can only show the handful of frames it has, which is what made it feel late.
 *
 * The wait itself is the brand: a block of ice losing its glaze into a puddle
 * that widens as the bytes land, drawn with the same SDF surface as the CTA.
 */
export function Preloader({ progress }: { progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pRef = useRef(0)
  const [flat, setFlat] = useState(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  pRef.current = Math.min(1, Math.max(0, progress))

  useEffect(() => {
    if (flat) return
    const canvas = canvasRef.current
    if (!canvas) return

    const field = createDripField({
      count: MAX_DRIPS,
      width: 100,
      x0: 0,
      originY: 0,
      maxLen: 58,
      r1: 7,
      r2: 3.6,
      bottom: 300,
      dropCap: MAX_DROPS,
      seed: 0x1cec0,
    })

    const cube = new Float32Array(4)
    const puddle = new Float32Array(4)
    let last = 0

    const dispose = createSketch(canvas, FRAG, (u, t, w, h) => {
      const dt = last ? t - last : 0.016
      last = t
      const p = pRef.current

      // the cube shrinks and rounds off as it goes, bobbing very slightly
      const hx = 74 - 30 * p
      const hy = 74 - 40 * p
      const cx = w / 2
      const cy = 104 + 12 * p + Math.sin(t * 0.9) * 2.5
      const cubeR = 14 + 14 * p

      const puddleY = h - 34
      const pw = 24 + 108 * p
      const ph = 4 + 8 * p

      // the glaze line climbs the cube as more of it turns to meltwater
      const glazeY = cy + hy - 2.0 * hy * (0.28 + 0.5 * p)

      // drips leave from the flat underside, not the rounded corners
      field.setGeometry({
        x0: cx - hx * 0.62,
        width: hx * 1.24,
        originY: cy + hy,
        bottom: puddleY - ph,
      })
      // always running — a loader that stalls looks broken — but harder as it fills
      field.step(dt, 0.5 + 0.5 * p)

      cube[0] = cx
      cube[1] = cy
      cube[2] = hx
      cube[3] = hy
      puddle[0] = cx
      puddle[1] = puddleY
      puddle[2] = pw
      puddle[3] = ph

      u.arr4('uCube', cube)
      u.arr4('uPuddle', puddle)
      u.f('uCubeR', cubeR)
      u.f('uGlazeY', glazeY)
      u.f('uP', p)
      u.arr4('uDrips', field.drips)
      u.arr3('uDrops', field.drops)
    })

    if (!dispose) {
      setFlat(true)
      return
    }
    return dispose
  }, [flat])

  const pct = Math.round(pRef.current * 100)

  return (
    <div className={`preloader${progress >= 1 ? ' preloader--done' : ''}`}>
      {flat ? (
        <div className="preloader-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${pRef.current})` }} />
        </div>
      ) : (
        <canvas className="preloader-canvas" ref={canvasRef} aria-hidden="true" />
      )}

      <p className="preloader-pct" role="status" aria-live="polite">
        {pct}
        <span>%</span>
      </p>
      <p className="preloader-word">Melting</p>
    </div>
  )
}
