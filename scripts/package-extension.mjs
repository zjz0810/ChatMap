import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(rootDir, "release");
const packageJsonPath = path.join(rootDir, "package.json");
const manifestPath = path.join(distDir, "manifest.json");

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function assertFile(filePath, label) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function assertArrayContainsAll(actual, expected, label) {
  const values = Array.isArray(actual) ? actual : [];
  const missing = expected.filter((value) => !values.includes(value));
  if (missing.length > 0) {
    throw new Error(`${label} missing expected entries: ${missing.join(", ")}`);
  }
}

async function assertContentScriptSelfContained() {
  const contentScriptPath = path.join(distDir, "content", "index.js");
  await assertFile(contentScriptPath, "Content script bundle");
  const source = await readFile(contentScriptPath, "utf8");
  const trimmed = source.trimStart();
  if (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("export ") ||
    /\bfrom\s*["']\.\.\/assets\//.test(source)
  ) {
    throw new Error("Content script bundle must be self-contained; Chrome classic content scripts cannot import chunks.");
  }
}

async function main() {
  await assertFile(manifestPath, "Built manifest");
  await assertContentScriptSelfContained();

  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const version = manifest.version ?? pkg.version;

  const requiredManifestFields = ["manifest_version", "name", "version", "permissions", "background"];
  const missingFields = requiredManifestFields.filter((field) => manifest[field] == null);
  if (missingFields.length > 0) {
    throw new Error(`Manifest is missing required fields: ${missingFields.join(", ")}`);
  }

  if (pkg.version !== version) {
    throw new Error(`Version mismatch: package.json has ${pkg.version}, manifest has ${version}`);
  }

  assertArrayContainsAll(
    manifest.permissions,
    ["activeTab", "scripting", "sidePanel", "storage", "tabs", "webRequest"],
    "Manifest permissions"
  );
  assertArrayContainsAll(
    manifest.host_permissions,
    [
      "https://chatgpt.com/backend-api/*",
      "https://api.openai.com/*",
      "https://api.deepseek.com/*",
      "https://openrouter.ai/*",
      "https://dashscope-intl.aliyuncs.com/*",
      "https://api.moonshot.ai/*",
      "https://ark.cn-beijing.volces.com/*",
      "https://open.bigmodel.cn/*",
      "https://api.mistral.ai/*"
    ],
    "Manifest host_permissions"
  );
  const contentScriptMatches = (manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []);
  assertArrayContainsAll(manifest.host_permissions, contentScriptMatches, "Built-in site host permissions");
  for (const resource of manifest.web_accessible_resources ?? []) {
    assertArrayContainsAll(resource.matches ?? [], contentScriptMatches, "Web-accessible site matches");
  }
  assertArrayContainsAll(
    manifest.optional_host_permissions,
    ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    "Manifest optional_host_permissions"
  );

  if (manifest.options_page !== "src/settings-page/index.html") {
    throw new Error(`Unexpected options_page: ${manifest.options_page}`);
  }
  if (manifest.side_panel?.default_path !== "src/side-panel/index.html") {
    throw new Error(`Unexpected side_panel.default_path: ${manifest.side_panel?.default_path}`);
  }

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    await assertFile(path.join(distDir, iconPath), `Manifest icon ${size}`);
  }
  for (const [size, iconPath] of Object.entries(manifest.action?.default_icon ?? {})) {
    await assertFile(path.join(distDir, iconPath), `Action icon ${size}`);
  }
  const webAccessibleResources = JSON.stringify(manifest.web_accessible_resources ?? []);
  if (!webAccessibleResources.includes("icons/chatmap-128.png")) {
    throw new Error("Manifest web_accessible_resources must expose icons/chatmap-128.png for the launcher");
  }

  await mkdir(releaseDir, { recursive: true });

  const archiveName = `chatmap-v${version}.zip`;
  const archivePath = path.join(releaseDir, archiveName);
  const unpackedDir = path.join(releaseDir, `chatmap-v${version}-unpacked`);
  const command = [
    `$items = Get-ChildItem -LiteralPath ${psQuote(distDir)}`,
    `Compress-Archive -Path $items.FullName -DestinationPath ${psQuote(archivePath)} -Force`,
  ].join("; ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    await rm(archivePath, { force: true });
    const fallback = spawnSync("tar.exe", ["-a", "-c", "-f", archivePath, "-C", distDir, "."], {
      cwd: rootDir,
      encoding: "utf8",
    });
    if (fallback.status !== 0) {
      throw new Error(
        `Compress-Archive and tar.exe ZIP packaging failed:\n${result.stderr || result.stdout}\n${fallback.stderr || fallback.stdout}`,
      );
    }
  }

  await assertFile(archivePath, "Release archive");

  await rm(unpackedDir, { recursive: true, force: true });
  await mkdir(unpackedDir, { recursive: true });
  await cp(distDir, unpackedDir, { recursive: true });
  await assertFile(path.join(unpackedDir, "manifest.json"), "Unpacked manifest");

  const readme = [
    `ChatMap ${version}`,
    "",
    `Archive: ${archiveName}`,
    `Built from: ${distDir}`,
    `Unpacked QA folder: ${unpackedDir}`,
    "",
    "Load unpacked for local QA:",
    "1. Open chrome://extensions (Chrome) or edge://extensions (Edge)",
    "2. Enable Developer mode",
    `3. Load unpacked: ${unpackedDir}`,
    "",
    "For distribution review, upload the zip archive in this release folder.",
    "",
  ].join("\n");

  await writeFile(path.join(releaseDir, "README.txt"), readme, "utf8");

  console.log(`Packaged ${archiveName}`);
  console.log(archivePath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
