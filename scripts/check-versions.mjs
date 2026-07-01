// Asserts every package in the changesets `fixed` group shares one version.
//
// The fixed group keeps the suite aligned during a normal release. This guard is the
// backstop: it catches drift from a hand-edited version, a reverted config, or a
// half-applied bump, and it runs as part of `pnpm check` so the failure surfaces in
// everyday development and CI, not at publish time.
//
// Packages outside the fixed group (e.g. website — private, deployed separately) are not
// versioned with the suite and are intentionally excluded.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const changesetConfig = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
const versioned = new Set(changesetConfig.fixed.flat());

const found = [];
for (const pkgName of versioned) {
  const manifest = join(root, "packages", pkgName.replace("@trainheroic-unofficial/", ""), "package.json");
  if (!existsSync(manifest)) {
    console.error(`✗ ${pkgName} is in the changesets fixed group but has no package.json`);
    process.exit(1);
  }
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
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
