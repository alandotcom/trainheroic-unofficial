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
