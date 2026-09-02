import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function posixPath(value) {
  return value.replaceAll("\\", "/");
}

/** Rewrite Wrangler's map-relative sources into stable paths from the repository root. */
export function normalizeSourceMap(sourceMap, { mapFile, repoRoot }) {
  if (!Array.isArray(sourceMap.sources)) throw new Error(`${mapFile} has no sources array`);

  const mapDirectory = dirname(resolve(mapFile));
  const root = resolve(repoRoot);
  const sources = sourceMap.sources.map((source) => {
    if (typeof source !== "string") throw new Error(`${mapFile} has a non-string source path`);
    const sourceFile = resolve(mapDirectory, source);
    const repositoryPath = posixPath(relative(root, sourceFile));
    if (repositoryPath === ".." || repositoryPath.startsWith("../") || isAbsolute(repositoryPath)) {
      throw new Error(`${source} resolves outside repository ${root}`);
    }
    return repositoryPath;
  });

  const { sourceRoot: _sourceRoot, ...rest } = sourceMap;
  return { ...rest, sources };
}

async function sourceMapFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceMapFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".map")) files.push(path);
  }
  return files;
}

async function main() {
  const directory = resolve(process.argv[2] ?? "dist");
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const files = await sourceMapFiles(directory);
  if (files.length === 0) throw new Error(`No source maps found in ${directory}`);

  for (const mapFile of files) {
    const sourceMap = JSON.parse(await readFile(mapFile, "utf8"));
    const normalized = normalizeSourceMap(sourceMap, { mapFile, repoRoot });
    await writeFile(mapFile, `${JSON.stringify(normalized)}\n`);
  }
  console.log(`Normalized ${files.length} source map(s) to repository-relative paths.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
