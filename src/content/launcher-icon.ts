export const TURNMAP_LAUNCHER_ICON_PATH = "icons/chatmap-128.png";

let launcherIconSrcPromise: Promise<string> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read ChatMap icon.")));
    reader.readAsDataURL(blob);
  });
}

export function getTurnMapLauncherIconUrl(): string {
  return chrome.runtime.getURL(TURNMAP_LAUNCHER_ICON_PATH);
}

export function loadTurnMapLauncherIconSrc(): Promise<string> {
  launcherIconSrcPromise ??= fetch(getTurnMapLauncherIconUrl())
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load ChatMap icon: ${response.status}`);
      return response.blob();
    })
    .then(blobToDataUrl)
    .catch(() => getTurnMapLauncherIconUrl());
  return launcherIconSrcPromise;
}
