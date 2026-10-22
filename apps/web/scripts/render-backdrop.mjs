// Renders the social-icon shader (scripts/backdrop-shader.html) to the WebP backgrounds in
// public/textures: light/dark x wide (2880x1800, for 1440-wide 2x screens) / tall (1290x2796, phones).
// The app shows these images instead of running WebGL live (DECISIONS.md D10).
// Run: npx -y playwright@1 install chromium && node scripts/render-backdrop.mjs
import { chromium } from "playwright";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto(`file://${path.join(here, "backdrop-shader.html")}`);
for (const [name, w, h] of [["wide", 2880, 1800], ["tall", 1290, 2796]]) {
  for (const [theme, dark] of [["light", 0], ["dark", 1]]) {
    const url = await p.evaluate(([w, h, d]) => window.render(w, h, d, 40.0), [w, h, dark]);
    const out = path.join(here, "..", "public", "textures", `bg-${theme}-${name}.webp`);
    const info = await sharp(Buffer.from(url.split(",")[1], "base64")).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(out);
    console.log(path.basename(out), `${w}x${h}`, `${Math.round(info.size / 1024)} KB`);
  }
}
await b.close();
