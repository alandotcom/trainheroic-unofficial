import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceMap } from "./normalize-sourcemaps.mjs";

test("normalizes Wrangler sources to repository-relative paths", () => {
  const sourceMap = {
    version: 3,
    sourceRoot: "dist",
    sources: [
      "../../js/src/http-error.ts",
      "../../db/src/stores/exercises.ts",
      "../src/index.ts",
      "../../../node_modules/pkg/index.js",
    ],
    sourcesContent: ["js", "db", "cloudflare", "dependency"],
    mappings: "AAAA",
  };

  const normalized = normalizeSourceMap(sourceMap, {
    mapFile: "/repo/packages/cloudflare/dist/index.js.map",
    repoRoot: "/repo",
  });

  assert.equal("sourceRoot" in normalized, false);
  assert.deepEqual(normalized.sources, [
    "packages/js/src/http-error.ts",
    "packages/db/src/stores/exercises.ts",
    "packages/cloudflare/src/index.ts",
    "node_modules/pkg/index.js",
  ]);
  assert.deepEqual(normalized.sourcesContent, sourceMap.sourcesContent);
  assert.equal(normalized.mappings, sourceMap.mappings);
});

test("rejects source paths outside the repository", () => {
  assert.throws(
    () =>
      normalizeSourceMap(
        { version: 3, sources: ["../../../../../../private/source.ts"], mappings: "" },
        {
          mapFile: "/repo/packages/cloudflare/dist/index.js.map",
          repoRoot: "/repo",
        },
      ),
    /outside repository/,
  );
});
