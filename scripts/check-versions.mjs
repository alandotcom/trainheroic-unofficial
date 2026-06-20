// Asserts every workspace package under packages/* shares one version.
//
// The `fixed` group in .changeset/config.json keeps the suite aligned during a normal
// release. This guard is the backstop: it catches drift from a hand-edited version, a
// reverted config, or a half-applied bump, and it runs as part of `pnpm check` so the
// failure surfaces in everyday development and CI, not at publish time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkgDir = join(root, "packages");

const found = [];
for (const name of readdirSync(pkgDir)) {
  const manifest = join(pkgDir, name, "package.json");
  if (!existsSync(manifest)) continue;
  const { name: pkgName, version } = JSON.parse(readFileSync(manifest, "utf8"));
  found.push({ pkgName, version });
}

const versions = [...new Set(found.map((p) => p.version))];

if (versions.length <= 1) {
  console.log(`✓ all ${found.length} packages at ${versions[0] ?? "(none)"}`);
  process.exit(0);
}

console.error("✗ package versions are out of sync — the suite must share one version:");
for (const { pkgName, version } of [...found].sort((a, b) => a.version.localeCompare(b.version))) {
  console.error(`    ${version.padEnd(10)} ${pkgName}`);
}
console.error(
  "\nFix with a changeset + `pnpm version-packages` (the fixed group bumps all of them together),",
);
console.error("or correct a stray hand-edit. Never bump packages individually.");
process.exit(1);
