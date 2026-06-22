import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const RAW = "?raw";

// Minimal shape of the rolldown plugin context used by the hook below.
type ResolveContext = {
  resolve(
    source: string,
    importer: string | undefined,
    options: { skipSelf: boolean },
  ): Promise<{ id: string } | null>;
};

type RawImportPlugin = {
  name: string;
  resolveId(
    this: ResolveContext,
    source: string,
    importer: string | undefined,
  ): Promise<string | null>;
  load(id: string): string | null;
};

/**
 * Resolve Vite-style `import sql from "./x.sql?raw"` during the tsdown (rolldown) build, the same
 * specifier Vitest honours natively. Strips the `?raw` query, reads the file, and inlines it as a
 * default-exported string so the migration DDL is embedded in the bundle (no runtime fs / dir read).
 */
function rawImport(): RawImportPlugin {
  return {
    name: "raw-import",
    async resolveId(source, importer) {
      if (!source.endsWith(RAW)) return null;
      const resolved = await this.resolve(source.slice(0, -RAW.length), importer, {
        skipSelf: true,
      });
      return resolved ? `${resolved.id}${RAW}` : null;
    },
    load(id) {
      if (!id.endsWith(RAW)) return null;
      const code = readFileSync(id.slice(0, -RAW.length), "utf8");
      return `export default ${JSON.stringify(code)};`;
    },
  };
}

export default defineConfig({
  entry: ["src/index.ts", "src/d1.ts", "src/sqlite.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  plugins: [rawImport()],
});
