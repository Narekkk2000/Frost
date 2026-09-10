import { useEffect, useRef, useState } from 'react'
import { createSketch, LIQUID_GLSL } from './gl'
import { createDripField } from './drips'

const MAX_DRIPS = 12
const MAX_DROPS = 14

const FRAG = `#version 300 es
${LIQUID_GLSL}
uniform vec2 uRes;
uniform float uDpr;
uniform float uBand;
uniform float uTime;
uniform vec4 uDrips[${MAX_DRIPS}];
uniform vec3 uDrops[${MAX_DROPS}];
out vec4 fragColor;

float dropField(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec3 c = uDrops[i];
    if (c.z <= 0.0) continue;
    vec2 q = p - c.xy;
    q.y *= 0.7;
    d = min(d, length(q) - c.z);
  }
  return d;
}

float edge(float x) {
  return uBand + 10.0 * sin(x * 0.012 + 0.4 * sin(uTime * 0.24))
    + 6.0 * sin(x * 0.027 + 1.7 + uTime * 0.18)
    + 3.0 * sin(x * 0.051 + 0.8);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uRes.y - gl_FragCoord.y / uDpr);

  // A slowly folding meniscus: no straight ledge between the drips.
  float d = p.y - edge(p.x);

  for (int i = 0; i < ${MAX_DRIPS}; i++) {
    vec4 dr = uDrips[i];
    if (dr.y <= 0.5) continue;
    float sway = sin(uTime * 0.4 + dr.x * 0.07) * dr.y * 0.035;
    vec2 a = vec2(dr.x, edge(dr.x) - 14.0);
    vec2 e = vec2(dr.x + sway, edge(dr.x) + dr.y);
    d = smin(d, sdCone(p, a, e, dr.z, dr.z * 0.40), 11.0);
    d = smin(d, length(p - e) - dr.w, 4.0);
  }

  d = smin(d, dropField(p), 3.0);

  vec3 base = vec3(241.0, 112.0, 171.0) / 255.0;
  vec3 col = gel(d, base, 18.0, normalize(vec3(-0.34, 0.72, 0.66)));

  float aa = max(fwidth(d), 0.55);
  float a = 1.0 - smoothstep(-aa, aa, d);
  // droplets dissolve into the page rather than clipping at the canvas edge
  float fade = 1.0 - smoothstep(uRes.y - 90.0, uRes.y, p.y);
  a *= fade;

  float sh = (1.0 - smoothstep(-8.0, 26.0, d - 14.0)) * 0.26 * fade;
  vec3 shadow = vec3(0.129, 0.267, 0.361);

  fragColor = vec4(col * a + shadow * sh * (1.0 - a), a + sh * (1.0 - a));
}
`

/**
 * The pink glaze poured across the top of the content page. Same SDF surface as
 * the button, so the band, its drips and the droplets it sheds are one body of
 * fluid — drips load up, pinch off and recoil on their own schedule.
 */
export function GlazeCeiling() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [flat, setFlat] = useState(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (flat) return
    const canvas = canvasRef.current
    if (!canvas) return

    const field = createDripField({
      count: MAX_DRIPS,
      width: 100,
      x0: 0,
      originY: 0,
      maxLen: 130,
      r1: 11,
      r2: 5.5,
      bottom: 400,
      dropCap: MAX_DROPS,
      seed: 0xc1a5e,
    })

    let last = 0
    const dispose = createSketch(canvas, FRAG, (u, t, w, h) => {
      const dt = last ? t - last : 0.016
      last = t
      const band = Math.min(76, Math.max(52, h * 0.2))
      // the glaze eases into motion as the page reveals, then keeps running
      const flow = Math.min(1, t / 1.6) * (0.82 + 0.18 * Math.sin(t * 0.31))
      field.setGeometry({
        x0: -10, width: w + 20, originY: band, bottom: h,
        originAt: (x) => band + 10 * Math.sin(x * 0.012 + 0.4 * Math.sin(t * 0.24))
          + 6 * Math.sin(x * 0.027 + 1.7 + t * 0.18) + 3 * Math.sin(x * 0.051 + 0.8),
      })
      field.step(dt, flow)
      u.f('uBand', band)
      u.f('uTime', t)
      u.arr4('uDrips', field.drips)
      u.arr3('uDrops', field.drops)
    })

    if (!dispose) {
      setFlat(true)
      return
    }
    return dispose
  }, [flat])

  if (flat) return <div className="glaze-flat" aria-hidden="true" />
  return <canvas className="glaze-canvas" ref={canvasRef} aria-hidden="true" />
}
