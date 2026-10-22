"use client";
// The live app background (DECISIONS.md D10): one WebGL canvas behind everything, drawing only the
// wall. Three parallax layers of line-drawn social icons (hearts, chat bubbles, @, #, cameras, play
// buttons) drift slowly upward over two soft glows, with film grain. A like or a new message sends a
// ripple out from that point, and the icons it passes over light up.
//
// Cards are NOT drawn here (they used to be, and lagged a frame behind their content while scrolling):
// they paint their own grid-paper background in CSS. With no WebGL, or before the first frame, the
// pre-rendered WebP of this same shader shows underneath (the .backdrop layer).
import { useEffect, useRef } from "react";
import { isDark } from "@/lib/theme";
import type { PulseKind } from "./Backdrop";

const PULSES = 8;


const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;         // device px
uniform float u_time;
uniform float u_dpr;
uniform float u_dark;       // 0 light .. 1 dark (animated)
uniform float u_motion;     // 0 when reduced motion
uniform int u_pcount;
uniform vec4 u_pulses[${PULSES}]; // x, y (from bottom, device px), age (s), kind (0 like, 1 message, 2 live)

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float dot2(vec2 v) { return dot(v, v); }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

// Icons, in a unit box (about -0.5..0.5). Each returns a signed distance; "outline" ones are stroked later.
float sdHeart(vec2 p) {            // Inigo Quilez's heart, centred
  p.y += 0.5; p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdBubble(vec2 p) {
  float body = sdBox(p - vec2(0.0, 0.06), vec2(0.48, 0.34), 0.24);
  float tail = sdBox(rot(0.75) * (p - vec2(-0.24, -0.3)), vec2(0.07, 0.12), 0.02);
  return min(body, tail);
}
float sdCamera(vec2 p) {
  float body = sdBox(p, vec2(0.48, 0.34), 0.1);
  float bump = sdBox(p - vec2(-0.16, 0.38), vec2(0.13, 0.06), 0.03);
  return min(min(body, bump), abs(length(p) - 0.17));
}
float sdTri(vec2 p, float r) {      // equilateral triangle pointing up (Inigo Quilez)
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdPlay(vec2 p) {
  float frame = sdBox(p, vec2(0.44, 0.44), 0.14);
  float tri = sdTri(rot(1.5708) * (p - vec2(0.03, 0.0)), 0.17); // turned to point right
  return min(abs(frame), tri);    // frame as a line, triangle filled
}
float sdAt(vec2 p) { return min(abs(length(p) - 0.44), abs(length(p) - 0.17)); }
float sdHash(vec2 p) {
  p = rot(0.18) * p;
  float d = sdBox(vec2(abs(p.x) - 0.15, p.y), vec2(0.035, 0.44), 0.03);
  return min(d, sdBox(vec2(p.x, abs(p.y) - 0.15), vec2(0.44, 0.035), 0.03));
}

// Distance in icon units; .y = 1 for shapes drawn as outlines.
vec2 icon(vec2 p, float k) {
  if (k < 1.0) return vec2(sdHeart(p * 1.1) / 1.1, 1.0);
  if (k < 2.0) return vec2(sdBubble(p), 1.0);
  if (k < 3.0) return vec2(sdAt(p), 0.0);
  if (k < 4.0) return vec2(sdHash(p), 0.0);
  if (k < 5.0) return vec2(sdCamera(p), 1.0);
  return vec2(sdPlay(p), 0.0);
}

vec3 iconColor(float k, float dark) {
  // A muted "social" palette: hearts red, bubbles blue, symbols neutral, camera/play warm orange.
  vec3 heart = mix(vec3(0.86, 0.22, 0.27), vec3(1.0, 0.42, 0.5), dark);
  vec3 bubble = mix(vec3(0.25, 0.43, 0.86), vec3(0.47, 0.62, 1.0), dark);
  vec3 neutral = mix(vec3(0.33, 0.36, 0.42), vec3(0.78, 0.8, 0.86), dark);
  vec3 warm = mix(vec3(0.93, 0.43, 0.13), vec3(1.0, 0.6, 0.3), dark);
  if (k < 1.0) return heart;
  if (k < 2.0) return bubble;
  if (k < 4.0) return neutral;
  return warm;
}

// One parallax layer. px in CSS px. Returns rgb premultiplied by alpha in .rgb, alpha in .a
vec4 layer(vec2 px, float cell, float speed, float seed, float soft, float strength, float excite) {
  vec2 p = px / cell;
  p.y -= u_time * speed;
  p.x += sin(p.y * 0.6 + seed) * 0.12;
  vec2 c = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash(c + seed);
  if (h > 0.42) return vec4(0.0);                         // sparse: most cells are empty
  float k = floor(hash(c + seed * 1.7 + 3.1) * 6.0);
  vec2 off = (vec2(hash(c + seed + 7.3), hash(c + seed + 1.9)) - 0.5) * 0.36;
  float r = (hash(c + 9.1 + seed) - 0.5) * 0.9 + sin(u_time * 0.35 + h * 40.0) * 0.12 * u_motion;
  float size = 0.26 + hash(c + 4.4 + seed) * 0.12;
  vec2 q = rot(r) * (f - off) / size;
  vec2 d = icon(q, k);
  float dpx = d.x * size * cell;                          // back to CSS px
  float s = mix(dpx, abs(dpx) - 0.75, d.y);               // outline: a 1.5px line
  float a = 1.0 - smoothstep(-soft, soft, s);
  float twinkle = 0.75 + 0.25 * sin(u_time * 0.9 + h * 50.0);
  a *= strength * twinkle * (1.0 + 2.5 * excite);
  return vec4(iconColor(k, u_dark) * a, a);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 px = frag / u_dpr;                                  // CSS px, y up
  vec2 uv = frag / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 q = vec2(uv.x * aspect, uv.y);
  float t = u_time * 0.035;

  // 1. Two soft glows over the wall colour, drifting.
  vec3 wallL = vec3(0.925, 0.933, 0.945), wallD = vec3(0.055, 0.063, 0.082);
  vec3 warmL = vec3(0.976, 0.84, 0.75),  warmD = vec3(0.26, 0.1, 0.16);
  vec3 coolL = vec3(0.8, 0.85, 0.92),    coolD = vec3(0.07, 0.11, 0.22);
  float w = fbm(q * 1.4 + vec2(t, -t * 0.6));
  float warmM = smoothstep(0.95, 0.15, length(q - vec2(aspect * 0.92 + 0.08 * sin(t * 2.0), 0.95)) - w * 0.35);
  float coolM = smoothstep(1.05, 0.2, length(q - vec2(0.05, 0.05 + 0.06 * cos(t * 1.7))) - fbm(q * 1.1 - t) * 0.4);
  vec3 col = mix(wallL, wallD, u_dark);
  col = mix(col, mix(warmL, warmD, u_dark), warmM * 0.55);
  col = mix(col, mix(coolL, coolD, u_dark), coolM * 0.5);

  // 2. Ripples from recent likes/messages: how strongly this pixel is "lit" right now.
  float excite = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    if (i >= u_pcount) break;
    vec4 pl = u_pulses[i];
    vec2 o = pl.xy / u_dpr;
    float age = pl.z, kind = pl.w;
    vec2 dv = px - o;
    float dist = length(dv);
    float R = age * 560.0;
    float ringW = 22.0 + age * 40.0;
    float fade = 1.0 - smoothstep(0.7, 1.8, age);
    excite += exp(-pow((dist - R) / ringW, 2.0)) * fade;
  }
  excite = min(excite, 1.5);

  // 3. The icon field: far (small, soft, faint) to near (bigger, sharper).
  float strength = mix(0.17, 0.22, u_dark);
  vec4 l1 = layer(px, 78.0, 0.010, 11.0, 1.6, strength * 0.55, excite);
  vec4 l2 = layer(px + vec2(37.0, 11.0), 118.0, 0.018, 23.0, 1.1, strength * 0.8, excite);
  vec4 l3 = layer(px + vec2(-61.0, 29.0), 170.0, 0.028, 37.0, 0.8, strength, excite);
  col = col * (1.0 - l1.a) + l1.rgb;
  col = col * (1.0 - l2.a) + l2.rgb;
  col = col * (1.0 - l3.a) + l3.rgb;
  vec3 ringTint = mix(vec3(0.95, 0.42, 0.11), vec3(1.0, 0.55, 0.25), u_dark);
  col = mix(col, ringTint, min(excite, 1.0) * 0.07);

  // 4. Film grain (frozen with reduced motion).
  float g = hash(px + fract(u_time * 13.1) * 100.0) - 0.5;
  col += g * mix(0.035, 0.03, u_dark);
  gl_FragColor = vec4(col, 1.0);
}`;

export function BackgroundShader() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const root = document.documentElement;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    const fail = () => { root.classList.remove("gl-on"); root.classList.add("no-gl"); canvas.style.display = "none"; };
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
    } catch (e) { console.warn("[shader]", e); return fail(); }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = {
      res: u("u_res"), time: u("u_time"), dpr: u("u_dpr"), dark: u("u_dark"), motion: u("u_motion"),
      pcount: u("u_pcount"), pulses: u("u_pulses"),
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pulseBuf = new Float32Array(PULSES * 4);
    let pulses: { x: number; y: number; start: number; kind: number }[] = [];
    // Which theme is showing: re-read only when it can change (Settings, or the OS switching).
    let targetDark = isDark() ? 1 : 0;
    let dark = targetDark;
    const retheme = () => { targetDark = isDark() ? 1 : 0; };
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", retheme);
    window.addEventListener("glimpse:theme", retheme);
    let raf = 0;
    let last = performance.now();
    const start = performance.now();
    const now = () => (performance.now() - start) / 1000;
    root.classList.add("gl-on"); // the WebP fallback underneath can stop decoding work

    const onPulse = (e: Event) => {
      if (reduce.matches) return;
      const d = (e as CustomEvent<{ kind: PulseKind; x?: number; y?: number }>).detail;
      const anchor = d.kind === "message" ? document.querySelector<HTMLElement>("[data-pulse-anchor='messages']")?.getBoundingClientRect() : null;
      const x = d.x ?? (anchor ? anchor.left + anchor.width / 2 : window.innerWidth - 80);
      const y = d.y ?? (anchor ? anchor.top + anchor.height / 2 : window.innerHeight - 80);
      pulses = [...pulses.slice(-(PULSES - 1)), { x, y, start: now(), kind: d.kind === "like" ? 0 : d.kind === "message" ? 1 : 2 }];
    };
    window.addEventListener("glimpse:pulse", onPulse);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      // Cap resolution: a 2018 MacBook's GPU doesn't need to shade 4x the pixels for grain.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      const t = now();
      pulses = pulses.filter((p) => t - p.start < 2.4);
      pulses.forEach((p, i) => pulseBuf.set([p.x * dpr, (window.innerHeight - p.y) * dpr, t - p.start, p.kind], i * 4));
      // Smooth cross-fade when the theme changes: time-based, so it takes ~0.4 s at any frame rate.
      const dt = Math.min(0.1, (performance.now() - last) / 1000); last = performance.now();
      dark += (targetDark - dark) * Math.min(1, dt * 9);
      if (Math.abs(targetDark - dark) < 0.002) dark = targetDark;

      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.time, reduce.matches ? 12.0 : t);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform1f(U.dark, dark);
      gl.uniform1f(U.motion, reduce.matches ? 0 : 1);
      gl.uniform1i(U.pcount, pulses.length);
      gl.uniform4fv(U.pulses, pulseBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    frame();
    const lost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); fail(); };
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("glimpse:pulse", onPulse);
      window.removeEventListener("glimpse:theme", retheme);
      mql.removeEventListener("change", retheme);
      canvas.removeEventListener("webglcontextlost", lost);
      root.classList.remove("gl-on");
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-[9] h-full w-full" />;
}
