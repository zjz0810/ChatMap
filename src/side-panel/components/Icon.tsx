import type { ReactElement } from "react";

export type IconName =
  | "brain"
  | "bug"
  | "chevronDown"
  | "close"
  | "copy"
  | "download"
  | "external"
  | "files"
  | "float"
  | "image"
  | "layout"
  | "map"
  | "maximize"
  | "panel"
  | "rebuild"
  | "refresh"
  | "redo"
  | "scan"
  | "search"
  | "settings"
  | "sparkles"
  | "trash"
  | "undo"
  | "upload"
  | "view";

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  decorative?: boolean;
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.9,
  className = "",
  decorative = true
}: IconProps) {
  return (
    <svg
      aria-hidden={decorative ? "true" : undefined}
      className={`turnmap-icon ${className}`.trim()}
      fill="none"
      height={size}
      role={decorative ? undefined : "img"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, ReactElement> = {
  brain: (
    <>
      <path d="M9 4.5a3 3 0 0 0-3 3v.4a3.2 3.2 0 0 0-2 3v.2a3.2 3.2 0 0 0 2.2 3 3.4 3.4 0 0 0 3.4 4.4H10V4.5Z" />
      <path d="M15 4.5a3 3 0 0 1 3 3v.4a3.2 3.2 0 0 1 2 3v.2a3.2 3.2 0 0 1-2.2 3 3.4 3.4 0 0 1-3.4 4.4H14V4.5Z" />
      <path d="M10 9H7.5M14 9h2.5M10 13H7.8M14 13h2.2" />
    </>
  ),
  bug: (
    <>
      <path d="M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0Z" />
      <path d="M3 13h5M16 13h5M4 19l4-3M16 16l4 3M4 7l4 3M16 10l4-3M10 4l-1-2M14 4l1-2M8 11h8" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  copy: (
    <>
      <rect height="12" rx="2" width="12" x="8" y="8" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m10 14 10-10" />
      <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
    </>
  ),
  files: (
    <>
      <path d="M7 3h7l4 4v14H7Z" />
      <path d="M14 3v5h5" />
      <path d="M4 7v14h12" />
    </>
  ),
  float: (
    <>
      <rect height="12" rx="3" width="14" x="5" y="6" />
      <path d="M8 10h8M8 14h5" />
    </>
  ),
  image: (
    <>
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <circle cx="8" cy="10" r="1.4" />
      <path d="m5 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0L16 17" />
      <path d="m14 15 1.2-1.2a1.5 1.5 0 0 1 2.1 0L20 16.5" />
    </>
  ),
  layout: (
    <>
      <rect height="6" rx="1.5" width="7" x="3" y="4" />
      <rect height="6" rx="1.5" width="7" x="14" y="4" />
      <rect height="6" rx="1.5" width="7" x="3" y="14" />
      <rect height="6" rx="1.5" width="7" x="14" y="14" />
    </>
  ),
  map: (
    <>
      <path d="M5 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M7.5 10.5 16.5 6M7.7 13.8l8.6 3.9" />
    </>
  ),
  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  panel: (
    <>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M9 4v16" />
    </>
  ),
  rebuild: (
    <>
      <path d="M4 7h9a5 5 0 0 1 0 10H8" />
      <path d="M8 13 4 17l4 4" />
      <path d="M17 3v5h5" />
      <path d="M22 8a8 8 0 0 0-14.5-3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-13.6 5.7" />
      <path d="M4 12A8 8 0 0 1 17.6 6.3" />
      <path d="M17 3v4h4" />
      <path d="M7 21v-4H3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 4 4-4 4" />
      <path d="M5 17v-2a4 4 0 0 1 4-4h10" />
    </>
  ),
  scan: (
    <>
      <path d="M7 4H5a1 1 0 0 0-1 1v2M17 4h2a1 1 0 0 1 1 1v2M7 20H5a1 1 0 0 1-1-1v-2M17 20h2a1 1 0 0 0 1-1v-2" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7.7 7.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7.1 7.1 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a7.1 7.1 0 0 0-1.8 1l-2.4-1-2 3.4L5 11a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.1 7.1 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a7.1 7.1 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z" />
      <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8Z" />
      <path d="m5 13 .7 1.8L7.5 15l-1.8.7L5 17.5l-.7-1.8L2.5 15l1.8-.7Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  undo: (
    <>
      <path d="m9 7-4 4 4 4" />
      <path d="M19 17v-2a4 4 0 0 0-4-4H5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V10" />
      <path d="m8 14 4-4 4 4" />
      <path d="M5 4h14" />
    </>
  ),
  view: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  )
};
