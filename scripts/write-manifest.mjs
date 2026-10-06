import { readFile, writeFile } from "node:fs/promises";
import manifest from "../src/manifest.ts";

const manifestPath = new URL("../public/manifest.json", import.meta.url);
const expected = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const actual = await readFile(manifestPath, "utf8");
  if (actual !== expected) {
    console.error("public/manifest.json is stale. Run node scripts/write-manifest.mjs.");
    process.exitCode = 1;
  } else {
    console.log("Manifest source is synchronized.");
  }
} else {
  await writeFile(manifestPath, expected, "utf8");
  console.log("Generated public/manifest.json from src/manifest.ts.");
}
