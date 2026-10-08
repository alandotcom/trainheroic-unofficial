/**
 * Render public/og-image.svg and public/apple-touch-icon.svg to the committed PNGs. Run it by hand
 * with `pnpm gen:social-images` after editing either SVG, and commit the PNGs. resvg draws the
 * SVG text with whatever fonts the machine has installed, so the PNG bytes differ between
 * machines; for that reason the script runs on demand and stays out of `predev` and `prebuild`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = join(import.meta.dirname, "..");
const publicDir = join(root, "public");

function renderSvg(name: string, width: number, height: number): void {
  const svg = readFileSync(join(publicDir, `${name}.svg`), "utf8");
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  })
    .render()
    .asPng();

  writeFileSync(join(publicDir, `${name}.png`), png);
  console.log(`wrote ${name}.png (${width}x${height})`);
}

renderSvg("og-image", 1200, 630);
renderSvg("apple-touch-icon", 180, 180);
