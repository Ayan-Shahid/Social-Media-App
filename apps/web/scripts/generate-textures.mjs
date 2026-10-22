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

const W = 720, H = 240; // 2x the widest button
const buttons = {
  // Dark ink with an orange safelight glow in one corner: primary actions.
  ink: [["#15171c", 0.15, 0.3], ["#262b36", 0.55, 0.8], ["#5a2a12", 0.95, 0.15], ["#1a1d24", 0.75, 0.5], ["#2d2236", 0.3, 0.95]],
  // Date-stamp orange: the one loud button (Share / Post).
  stamp: [["#f2691b", 0.2, 0.4], ["#ffa25c", 0.85, 0.15], ["#c9420f", 0.6, 0.9], ["#ff7d2e", 0.4, 0.05], ["#e85a14", 0.95, 0.85]],
  // Paper: secondary actions.
  paper: [["#f6f3ee", 0.2, 0.3], ["#ffffff", 0.6, 0.1], ["#f3e2d6", 0.95, 0.8], ["#e6ebf2", 0.05, 0.9], ["#faf6f0", 0.5, 0.6]],
  // Dark theme: the primary button inverts to frosted light; secondary becomes charcoal.
  "ink-dark": [["#eef0f4", 0.15, 0.3], ["#ffffff", 0.55, 0.8], ["#ffd9bf", 0.95, 0.15], ["#e3e7ef", 0.75, 0.5], ["#efe6f6", 0.3, 0.95]],
  "paper-dark": [["#1d2027", 0.2, 0.3], ["#262a33", 0.6, 0.1], ["#2e2228", 0.95, 0.8], ["#1a1f2a", 0.05, 0.9], ["#22252d", 0.5, 0.6]],
};

mkdirSync("public/textures", { recursive: true });
for (const [name, pts] of Object.entries(buttons)) {
  const img = mesh(W, H, pts, name.startsWith("paper") || name === "ink-dark" ? 16 : 22);
  const info = await img.webp({ quality: 88 }).toFile(`public/textures/btn-${name}.webp`);
  console.log(`btn-${name}.webp`, info.size, "bytes");
}
const bg = await mesh(1200, 800, [["#e8ebf0", 0.2, 0.2], ["#f4dccb", 0.9, 0.1], ["#d6deea", 0.1, 0.9], ["#eceef1", 0.55, 0.5], ["#efe4f0", 0.85, 0.85]], 10)
  .webp({ quality: 80 }).toFile("public/textures/bg-static.webp");
console.log("bg-static.webp", bg.size, "bytes");
const bgDark = await mesh(1200, 800, [["#101218", 0.2, 0.2], ["#2a1a22", 0.9, 0.1], ["#141b2a", 0.1, 0.9], ["#0f1115", 0.55, 0.5], ["#1d1528", 0.85, 0.85]], 9)
  .webp({ quality: 80 }).toFile("public/textures/bg-static-dark.webp");
console.log("bg-static-dark.webp", bgDark.size, "bytes");
