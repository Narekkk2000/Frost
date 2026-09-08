import { useEffect, useRef } from 'react'
import { createSketch } from './gl'

/**
 * The content page's backdrop: domain-warped fractal noise, which is how you get
 * the veined, slowly-shifting look of light through ice. Two feedback passes of
 * fBm (the field is offset by a fBm of itself, twice) produce the swirling
 * filaments — a blurred circle can't do that no matter how many you stack.
 */
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80); // rotate each octave to hide the grid
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 px = gl_FragCoord.xy / uDpr;
  vec2 uv = (px - 0.5 * uRes) / uRes.y;
  uv.y = -uv.y;
  float t = uTime * 0.035;

  vec2 p = uv * 2.6;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + 0.22 * t),
                fbm(p + 3.4 * q + vec2(8.3, 2.8) - 0.18 * t));
  float f = fbm(p + 3.2 * r);

  vec3 deep = vec3(0.098, 0.278, 0.396);
  vec3 mid  = vec3(0.263, 0.451, 0.561);
  vec3 lite = vec3(0.478, 0.667, 0.788);
  vec3 pale = vec3(0.831, 0.918, 0.973);

  vec3 col = mix(deep, mid, clamp(f * 1.7, 0.0, 1.0));
  col = mix(col, lite, clamp(dot(r, r) * 1.1, 0.0, 1.0));
  col = mix(col, pale, clamp(q.x * q.x * 0.85, 0.0, 1.0));

  // thin bright filaments where the warp folds back on itself — cracks in the ice
  float vein = 1.0 - abs(f * 2.0 - 1.0);
  col += pale * pow(vein, 7.0) * 0.35;

  // a breath of the glaze pink bleeding down from the top of the page
  float bleed = smoothstep(0.55, -0.15, uv.y + 0.35) * clamp(q.y, 0.0, 1.0);
  col = mix(col, vec3(0.906, 0.584, 0.741), bleed * 0.14);

  // settle the bottom so the type always has something quiet to sit on
  float depth = smoothstep(-0.1, 0.62, uv.y);
  col = mix(col, deep * 0.82, depth * 0.55);

  float vig = smoothstep(1.25, 0.28, length(uv * vec2(0.78, 1.0)));
  col *= 0.62 + 0.38 * vig;

  // fine frozen grain, so it reads as ice rather than a smooth gradient
  col += (hash(px + fract(uTime) * 91.7) - 0.5) * 0.035;

  fragColor = vec4(col, 1.0);
}
`

export function FrostField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // half resolution: it is a soft, slow field — nobody can see the difference
    return createSketch(canvas, FRAG, () => {}, 0.5) ?? undefined
  }, [])

  return <canvas className="frost-field" ref={canvasRef} aria-hidden="true" />
}
