import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? sourceFiles(url) : /\.(ts|tsx)$/.test(entry.name) ? [url] : [];
  });
}

test("localization is a top-level module shared by every execution context", () => {
  const localizationModule = new URL("../src/localization/index.ts", import.meta.url);
  assert.equal(existsSync(localizationModule), true);

  const staleImports = sourceFiles(new URL("../src/", import.meta.url)).filter((file) =>
    readFileSync(file, "utf8").includes("side-panel/i18n/i18n-storage")
  );
  assert.deepEqual(staleImports.map((file) => file.pathname), []);
});

test("localization catalogs are separate from runtime and storage implementation", () => {
  const catalogs = new URL("../src/localization/catalogs.ts", import.meta.url);
  const runtime = new URL("../src/localization/index.ts", import.meta.url);

  assert.equal(existsSync(catalogs), true);
  assert.ok(readFileSync(catalogs, "utf8").split(/\r?\n/).length > 900);
  assert.ok(readFileSync(runtime, "utf8").split(/\r?\n/).length < 600);
});
