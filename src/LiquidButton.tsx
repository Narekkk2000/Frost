import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createSketch, LIQUID_GLSL } from './gl'
import { createDripField } from './drips'

const MAX_DRIPS = 10
const MAX_DROPS = 8

/** room around the pill for the glaze to run into, in CSS px */
const PAD_X = 26
const PAD_TOP = 18
const PAD_BOTTOM = 150

const FRAG = `#version 300 es
${LIQUID_GLSL}
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uPill;    // cx, cy, halfW, halfH
uniform float uHot;
uniform float uHover;
uniform float uTime;
uniform vec4 uDrips[${MAX_DRIPS}];  // x, length, root radius, bead radius
uniform vec3 uDrops[${MAX_DROPS}];  // x, y, radius
out vec4 fragColor;

// free droplets, slightly stretched along the direction they fall
float dropField(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec3 c = uDrops[i];
    if (c.z <= 0.0) continue;
    vec2 q = p - c.xy;
    q.y *= 0.74;
    d = min(d, length(q) - c.z);
  }
  return d;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / uDpr, uRes.y - gl_FragCoord.y / uDpr);
  vec2 c = uPill.xy;
  vec2 b = uPill.zw;
  float top = c.y - b.y;

  vec2 bodyPoint = p + vec2(0.0, sin((p.x - c.x) * 0.038) * uHot * 1.4);
  float dPill = sdRoundBox(bodyPoint, c, b, b.y);

  // One continuous body: the drips grow from the pill's underside. There is
  // no second clipped layer, so no horizontal paint seam across the button.
  float glazeY = c.y + b.y - 5.0;
  float dGlaze = dPill;

  for (int i = 0; i < ${MAX_DRIPS}; i++) {
    vec4 dr = uDrips[i];
    if (dr.y <= 0.5) continue;
    float sway = sin(uTime * 0.55 + dr.x * 0.11) * 1.5 * dr.y * 0.02;
    vec2 a = vec2(dr.x, glazeY - 8.0);
    vec2 e = vec2(dr.x + sway, glazeY + dr.y);
    // neck first, then the bead loading its tip
    dGlaze = smin(dGlaze, sdCone(p, a, e, dr.z, dr.z * 0.42), 6.5);
    dGlaze = smin(dGlaze, length(p - e) - dr.w, 3.0);
  }

  float dFree = dropField(p);
  // a droplet that has only just let go still wants to rejoin the drip above it
  float dLiquid = smin(dGlaze, dFree, 2.5);
  float d = min(dPill, dLiquid);

  vec3 brandPink = vec3(241.0, 112.0, 171.0) / 255.0;
  vec3 base = mix(vec3(0.84, 0.94, 0.98), brandPink, uHot);
  // The whole pill has volume; the necks and beads have a smaller curvature.
  float below = smoothstep(c.y + b.y - 12.0, c.y + b.y + 12.0, p.y);
  float radius = mix(b.y * 1.1, 8.5, below);
  vec3 col = gel(d, base, radius, normalize(vec3(-0.40, 0.70, 0.68)));

  // frost crust while it is still cold
  float frost = (1.0 - uHot) * (1.0 - smoothstep(-6.0, 1.0, dPill));
  col = mix(col, mix(col, vec3(1.0), 0.55), frost);

  // hovering warms it: more light through the body, more running glaze
  col *= 1.0 + 0.10 * uHover;

  float aa = max(fwidth(d), 0.55);
  float a = 1.0 - smoothstep(-aa, aa, d);

  // contact shadow, so the pill sits on the footage instead of floating over it
  float ds = sdRoundBox(p - vec2(0.0, 10.0), c, b, b.y);
  float sh = (1.0 - smoothstep(-6.0, 18.0, ds)) * 0.32;
  vec3 shadow = vec3(0.145, 0.278, 0.369);

  fragColor = vec4(col * a + shadow * sh * (1.0 - a), a + sh * (1.0 - a));
}
`

/**
 * The CTA, drawn as a real signed-distance field rather than stacked divs: the
 * pill, the glaze poured over it and every drip and shed droplet are one merged
 * surface, lit with a specular highlight that travels as the fluid moves.
 *
 * Falls back to a plain CSS pill when WebGL2 is unavailable or the visitor has
 * asked for reduced motion.
 */
export function LiquidButton({ melt, top }: { melt: number; top: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hotRef = useRef(0)
  const hoverRef = useRef(0)
  const [flat, setFlat] = useState(
    () =>
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // 0 → frozen solid, 1 → fully thawed and running
  hotRef.current = Math.min(1, Math.max(0, (melt - 0.08) / 0.52))

  useEffect(() => {
    if (flat) return
    const canvas = canvasRef.current
    if (!canvas) return

    const field = createDripField({
      count: MAX_DRIPS,
      width: 100,
      x0: PAD_X,
      originY: PAD_TOP,
      maxLen: 58,
      r1: 7.5,
      r2: 3.4,
      bottom: 200,
      dropCap: MAX_DROPS,
      seed: 0x1ce,
    })

    const pill = new Float32Array(4)
    let last = 0
    let hover = 0
    const dispose = createSketch(
      canvas,
      FRAG,
      (u, t, w, h) => {
        const dt = last ? t - last : 0.016
        last = t
        hover += (hoverRef.current - hover) * Math.min(1, dt * 5)

        const hot = hotRef.current
        const ph = h - PAD_TOP - PAD_BOTTOM
        const cx = w / 2
        const cy = PAD_TOP + ph / 2
        const hw = Math.max(ph / 2, w / 2 - PAD_X)
        const hh = ph / 2
        const glazeY = PAD_TOP + ph - 5

        // drips only hang off the flat part of the glaze, not the rounded ends
        field.setGeometry({
          x0: cx - hw + hh * 0.5,
          width: 2 * (hw - hh * 0.5),
          originY: glazeY,
          bottom: h,
        })
        // pointing at it warms it a little past where the scroll has got to
        field.step(dt, Math.min(1, hot + 0.28 * hover))

        pill[0] = cx
        pill[1] = cy
        pill[2] = hw
        pill[3] = hh
        u.f('uHot', hot)
        u.f('uHover', hover)
        u.f('uTime', t)
        u.arr4('uPill', pill)
        u.arr4('uDrips', field.drips)
        u.arr3('uDrops', field.drops)
      },
      1,
    )

    if (!dispose) {
      setFlat(true)
      return
    }
    return dispose
  }, [flat])

  return (
    <a
      className={`lbtn${flat ? ' lbtn--flat' : ''}`}
      href="#/info"
      style={{ top: `${top}px`, '--hot': Math.round(hotRef.current * 100) / 100 } as CSSProperties}
      onPointerEnter={() => (hoverRef.current = 1)}
      onPointerLeave={() => (hoverRef.current = 0)}
      onFocus={() => (hoverRef.current = 1)}
      onBlur={() => (hoverRef.current = 0)}
    >
      {!flat && <canvas className="lbtn-canvas" ref={canvasRef} aria-hidden="true" />}
      <span className="lbtn-label">Keep In Touch</span>
    </a>
  )
}
