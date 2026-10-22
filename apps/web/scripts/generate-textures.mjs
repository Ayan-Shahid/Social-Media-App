// Generates the grainy mesh-gradient WebP textures used for buttons and the static background.
// Mesh gradient: each pixel blends a handful of coloured control points, weighted by distance
// (smooth, organic colour fields), then fine film grain is added to every pixel.
// Run: npm run textures   (outputs to public/textures; deterministic thanks to the fixed seed)
import sharp from "sharp";
import { mkdirSync } from "node:fs";

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function mesh(W, H, points, grain, falloff = 2.2) {
  const px = Buffer.alloc(W * H * 3);
  const pts = points.map(([c, x, y]) => ({ c: hex(c), x: x * W, y: y * H }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, wsum = 0;
      for (const p of pts) {
        const dx = (x - p.x) / W, dy = (y - p.y) / H * (H / W) * 2.2;
        const w = 1 / Math.pow(dx * dx + dy * dy + 0.0008, falloff / 2);
        r += p.c[0] * w; g += p.c[1] * w; b += p.c[2] * w; wsum += w;
      }
      // Gaussian-ish grain: sum of randoms, centred on 0.
      const n = (rand() + rand() + rand() - 1.5) * grain;
      const i = (y * W + x) * 3;
      px[i] = Math.max(0, Math.min(255, r / wsum + n));
      px[i + 1] = Math.max(0, Math.min(255, g / wsum + n));
      px[i + 2] = Math.max(0, Math.min(255, b / wsum + n));
    }
  }
  return sharp(px, { raw: { width: W, height: H, channels: 3 } });
}

// 1200x300, shown at 600x150 CSS px: 2x for retina, so the grain stays one physical pixel and crisp.
// Buttons show a window into it; hover slides the window, so the colours visibly drift.
const W = 1200, H = 300;
const buttons = {
  // Ink: deep navy into plum, with a burnt-orange safelight glow. Primary actions.
  ink: [["#0f1424", 0.05, 0.2], ["#2a1f4a", 0.35, 0.9], ["#7a2e14", 0.62, 0.1], ["#141a2e", 0.8, 0.7], ["#3d1838", 0.98, 0.25], ["#1b2440", 0.25, 0.35]],
  // Date-stamp orange into hot pink and amber: the one loud button (Share / Go live).
  stamp: [["#ff5a1f", 0.08, 0.5], ["#ffb347", 0.35, 0.05], ["#e8336e", 0.55, 0.95], ["#ff7a2e", 0.75, 0.3], ["#ffcf6b", 0.95, 0.85], ["#f04b2a", 0.25, 0.8]],
  // Paper: warm white into a hint of peach and sky. Secondary actions.
  paper: [["#fdf6ee", 0.08, 0.3], ["#ffffff", 0.32, 0.05], ["#ffd7bb", 0.58, 0.95], ["#cfe0fa", 0.82, 0.15], ["#f1dcf3", 0.3, 0.92], ["#fff1e2", 0.98, 0.7]],
  // Dark theme: primary inverts to frosted light with a peach glow; secondary is charcoal with a plum tint.
  "ink-dark": [["#f1f3f7", 0.1, 0.3], ["#ffffff", 0.45, 0.85], ["#ffd0ad", 0.7, 0.1], ["#dfe6f3", 0.9, 0.7], ["#f1e2f6", 0.3, 0.95]],
  "paper-dark": [["#1a1d25", 0.08, 0.3], ["#302742", 0.4, 0.05], ["#3d2430", 0.62, 0.95], ["#172338", 0.85, 0.2], ["#25282f", 0.3, 0.9]],
};

mkdirSync("public/textures", { recursive: true });
for (const [name, pts] of Object.entries(buttons)) {
  const img = mesh(W, H, pts, name.startsWith("paper") || name === "ink-dark" ? 20 : 24, 2.0);
  const info = await img.webp({ quality: 84 }).toFile(`public/textures/btn-${name}.webp`);
  console.log(`btn-${name}.webp`, info.size, "bytes");
}
// The page background is rendered from the shader instead: scripts/render-backdrop.mjs
