import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public package and extension branding use ChatMap while retaining upstream attribution", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const manifestSource = await readFile(new URL("../src/manifest.ts", import.meta.url), "utf8");
  const iconSource = await readFile(new URL("../public/icons/chatmap.svg", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
  const contentSource = await readFile(new URL("../src/content/index.ts", import.meta.url), "utf8");

  assert.equal(packageJson.name, "chatmap");
  assert.match(manifestSource, /name:\s*"ChatMap"/);
  assert.match(manifestSource, /default_title:\s*"Open ChatMap"/);
  assert.match(manifestSource, /chatmap-128\.png/);
  assert.match(readme, /^# ChatMap/m);
  assert.match(readme, /ChatMap is a derivative project based on \[Zhaimiaoyizhi\/TurnMap\]/);
  assert.match(iconSource, /aria-label="ChatMap"/);
  assert.match(appSource, /className="app-brand__logo" src=\{getTurnMapLauncherIconUrl\(\)\}/);
  assert.doesNotMatch(contentSource, /\.turnmap-launcher::after/);
});
