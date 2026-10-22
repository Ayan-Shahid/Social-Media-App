"use client";
// One WebGL canvas behind the whole app (DECISIONS.md D10).
//  - Background: a slow darkroom "light leak" field with animated film grain.
//  - Card surfaces: every element marked `data-surface` is drawn as paper (fibre texture, soft edge)
//    by the SAME shader. Each frame we pass up to 16 visible card rectangles as uniforms.
// Why one canvas: browsers allow ~16 WebGL contexts per page; a canvas per card breaks on long feeds.
// Fallbacks: no WebGL -> static image + plain white cards. Reduced motion -> time is frozen.
import { useEffect, useRef } from "react";

const MAX = 16;

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform int u_count;
uniform vec4 u_rects[${MAX}];   // x, y (from bottom), w, h in device pixels
uniform float u_radii[${MAX}];

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 q = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.035;

  // Background: fog wall with a warm safelight leak (top right) and a cool one (bottom left), drifting.
  vec3 fog = vec3(0.925, 0.933, 0.945);
  vec3 warm = vec3(0.976, 0.835, 0.737);
  vec3 cool = vec3(0.800, 0.843, 0.910);
  float w = fbm(q * 1.4 + vec2(t, -t * 0.6));
  float warmMask = smoothstep(0.95, 0.15, length(q - vec2(aspect * 0.92 + 0.08 * sin(t * 2.0), 0.95)) - w * 0.35);
  float coolMask = smoothstep(1.05, 0.2, length(q - vec2(0.05, 0.05 + 0.06 * cos(t * 1.7))) - fbm(q * 1.1 - t) * 0.4);
  vec3 col = mix(fog, warm, warmMask * 0.55);
  col = mix(col, cool, coolMask * 0.45);

  // Cards: paper inside each rectangle, a soft contact shadow just outside.
  float shadow = 0.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= u_count) break;
    vec4 r = u_rects[i];
    vec2 c = r.xy + r.zw * 0.5;
    float d = sdBox(frag - c, r.zw * 0.5, u_radii[i]);
    float sd = sdBox(frag - c + vec2(0.0, 6.0 * u_dpr), r.zw * 0.5, u_radii[i]);
    shadow = max(shadow, exp(-max(sd, 0.0) / (16.0 * u_dpr)) * step(0.0, d) * 0.07);
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    if (inside > 0.0) {
      vec2 local = (frag - r.xy) / u_dpr;
      float fibre = fbm(vec2(local.x * 0.9, local.y * 0.08) + float(i) * 7.0) * 0.5 + fbm(local * 0.35) * 0.5;
      float sheen = smoothstep(0.0, 1.0, 0.5 + 0.5 * sin((local.x + local.y) * 0.004 - u_time * 0.25)) * 0.025;
      vec3 paper = vec3(0.995, 0.993, 0.988) - fibre * 0.035 + sheen;
      col = mix(col, paper, inside);
    }
  }
  col *= 1.0 - shadow;

  // Film grain: changes every frame (frozen with reduced motion).
  float g = hash(frag / u_dpr + fract(u_time * 13.1) * 100.0) - 0.5;
  col += g * 0.035;
  gl_FragColor = vec4(col, 1.0);
}`;

export function ShaderBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const root = document.documentElement;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    const fail = () => { root.classList.remove("gl-on"); root.classList.add("no-gl"); };
    if (!gl) return fail();

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    } catch { return fail(); }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("u_res"), uTime = u("u_time"), uDpr = u("u_dpr"), uCount = u("u_count"), uRects = u("u_rects"), uRadii = u("u_radii");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rects = new Float32Array(MAX * 4);
    const radii = new Float32Array(MAX);
    let raf = 0;
    const start = performance.now();
    root.classList.add("gl-on");

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      // Cap resolution: a 2018 MacBook's GPU doesn't need to shade 4x the pixels for grain.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      let n = 0;
      for (const el of document.querySelectorAll<HTMLElement>("[data-surface]")) {
        if (n >= MAX) break;
        const b = el.getBoundingClientRect();
        if (b.bottom < -40 || b.top > window.innerHeight + 40 || b.width === 0) continue;
        rects.set([b.left * dpr, (window.innerHeight - b.bottom) * dpr, b.width * dpr, b.height * dpr], n * 4);
        radii[n] = parseFloat(getComputedStyle(el).borderTopLeftRadius || "0") * dpr;
        n++;
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, reduce.matches ? 12.0 : (performance.now() - start) / 1000);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1i(uCount, n);
      gl.uniform4fv(uRects, rects);
      gl.uniform1fv(uRadii, radii);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame();
    const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); fail(); };
    canvas.addEventListener("webglcontextlost", lost);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener("webglcontextlost", lost); root.classList.remove("gl-on"); };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
