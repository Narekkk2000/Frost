/**
 * Minimal WebGL2 sketch runner: a fullscreen triangle, a fragment shader, and
 * a render loop that stays out of the way when the tab is hidden.
 *
 * Everything visual in this project that has to look like liquid is drawn as a
 * signed distance field rather than as DOM elements — SDFs merge, bead and
 * pinch off the way real fluid does, and they shade with a real specular
 * highlight, which is the difference between "glossy gel" and "rounded div".
 */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export type Uniforms = {
  f(name: string, x: number): void
  v2(name: string, x: number, y: number): void
  arr4(name: string, data: Float32Array): void
  arr3(name: string, data: Float32Array): void
  i(name: string, x: number): void
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh), source)
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/**
 * `draw` runs once per frame with the canvas size in CSS pixels; set whatever
 * uniforms the shader needs and return. Returns a disposer, or null if WebGL2
 * isn't available so the caller can fall back.
 */
export function createSketch(
  canvas: HTMLCanvasElement,
  frag: string,
  draw: (u: Uniforms, seconds: number, w: number, h: number) => void,
  resolutionScale = 1,
): (() => void) | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
  })
  if (!gl) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  if (!vs || !fs) return null

  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)

  const locs = new Map<string, WebGLUniformLocation | null>()
  const loc = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name))
    return locs.get(name) ?? null
  }
  const u: Uniforms = {
    f: (n, x) => gl.uniform1f(loc(n), x),
    v2: (n, x, y) => gl.uniform2f(loc(n), x, y),
    arr4: (n, d) => gl.uniform4fv(loc(n), d),
    arr3: (n, d) => gl.uniform3fv(loc(n), d),
    i: (n, x) => gl.uniform1i(loc(n), x),
  }

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // shaders output premultiplied

  let w = 0
  let h = 0
  const resize = () => {
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    if (!cw || !ch) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * resolutionScale
    const pw = Math.max(1, Math.round(cw * dpr))
    const ph = Math.max(1, Math.round(ch * dpr))
    w = cw
    h = ch
    if (canvas.width === pw && canvas.height === ph) return
    canvas.width = pw
    canvas.height = ph
    gl.viewport(0, 0, pw, ph)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  let raf = 0
  const start = performance.now()
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (document.hidden || !w || !h) return
    gl.useProgram(prog)
    u.v2('uRes', w, h)
    u.f('uDpr', canvas.width / w)
    draw(u, (now - start) / 1000, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  raf = requestAnimationFrame(frame)

  // NB: never call WEBGL_lose_context here. Losing a context is permanent for
  // that canvas element, and StrictMode remounts the effect on the same canvas —
  // the second mount would get the dead context back and every shader would
  // fail to compile with an empty info log.
  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    gl.deleteProgram(prog)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
  }
}

/** SDF primitives + the gel shading model, shared by the button and the ceiling. */
export const LIQUID_GLSL = `
precision highp float;

// polynomial smooth minimum — what makes separate blobs merge like fluid
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdRoundBox(vec2 p, vec2 c, vec2 b, float r) {
  vec2 q = abs(p - c) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// tapered capsule: a drip, wide at the glaze and narrowing to the bead
float sdCone(vec2 p, vec2 a, vec2 b, float r1, float r2) {
  vec2 ba = b - a;
  float l2 = dot(ba, ba);
  if (l2 < 1e-4) return length(p - a) - r1;
  float rr = r1 - r2;
  float a2 = l2 - rr * rr;
  float il2 = 1.0 / l2;
  vec2 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  vec2 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/**
 * Shade an SDF as a blob of glossy gel. The distance field is turned into a
 * dome height, the dome into a normal, and the normal into diffuse + specular
 * + fresnel — so the highlight actually travels across the surface as drips
 * stretch, instead of being a baked-in gradient.
 */
vec3 gel(float d, vec3 base, float radius, vec3 lightDir) {
  float t = clamp(-d / radius, 0.0, 1.0);
  float dome = sqrt(max(t * (2.0 - t), 1e-5));
  float slope = -(1.0 - t) / (dome * radius);
  vec2 g = vec2(dFdx(d), dFdy(d));
  g = length(g) > 1e-6 ? normalize(g) : vec2(0.0);
  vec3 n = normalize(vec3(-slope * g, 1.0));

  float diff = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 half3 = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, half3), 0.0, 1.0), 46.0);
  float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);

  vec3 col = base * (0.70 + 0.46 * diff);
  col += vec3(1.0, 0.99, 0.97) * spec * 0.85;
  col += vec3(0.80, 0.92, 1.0) * fres * 0.20;
  return col;
}
`
