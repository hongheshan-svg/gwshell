import React from 'react';
import { detectOsDistro } from '../../lib/osDistro';

export type ProtocolIconType =
  'ssh' | 'localshell' | 'docker' | 'serial' | 'quickconnect' | 'tunnel' | 'remote';

/** Colorful, crisp OS / Linux distribution SVG badge. */
export const OsDistroIcon: React.FC<{ osPretty?: string | null; size?: number }> = React.memo(
  ({ osPretty, size = 20 }) => {
    const kind = detectOsDistro(osPretty);
    switch (kind) {
      case 'ubuntu':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#e95420" />
            <circle cx="12" cy="12" r="5" fill="none" stroke="#fff" strokeWidth="1.9" />
            <circle cx="12" cy="6.2" r="1.75" fill="#fff" stroke="#e95420" strokeWidth="0.9" />
            <circle cx="7" cy="14.9" r="1.75" fill="#fff" stroke="#e95420" strokeWidth="0.9" />
            <circle cx="17" cy="14.9" r="1.75" fill="#fff" stroke="#e95420" strokeWidth="0.9" />
          </svg>
        );
      case 'debian':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#d70a53" />
            <path
              d="M12.3 15.8c-2.6-.1-4.3-2-4.2-4.4.1-2.5 2.1-4.3 4.6-4.2 2 .1 3.5 1.5 3.4 3.4-.1 1.5-1.2 2.5-2.6 2.4-1.1-.1-1.8-.9-1.7-1.9.1-.8.7-1.2 1.4-1.1"
              fill="none"
              stroke="#fff"
              strokeWidth="1.85"
              strokeLinecap="round"
            />
          </svg>
        );
      case 'rocky':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#10b981" />
            <path d="M6.8 16.8 12.2 8.2l5 8.6h-3.1l-1.9-3.2-2.2 3.2Z" fill="#fff" />
          </svg>
        );
      case 'centos':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#1e293b" />
            <rect x="5" y="5" width="6.2" height="6.2" rx="1.2" fill="#9333ea" />
            <rect x="12.8" y="5" width="6.2" height="6.2" rx="1.2" fill="#22c55e" />
            <rect x="5" y="12.8" width="6.2" height="6.2" rx="1.2" fill="#eab308" />
            <rect x="12.8" y="12.8" width="6.2" height="6.2" rx="1.2" fill="#3b82f6" />
          </svg>
        );
      case 'redhat':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#dc2626" />
            <path
              d="M6.2 13.6c1.5 1.9 4.5 2.7 7.6 2.2 2.2-.3 3.7-1.3 4-2.5-.9-.6-1.9-.9-2.7-1l-.8-3.4c-.3-1.1-1.3-1.6-2.4-1.3l-2 .6c-1 .3-1.6 1.1-1.7 2.1l-.4 1.8c-.7.3-1.3.8-1.6 1.5Z"
              fill="#fff"
            />
          </svg>
        );
      case 'alpine':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#0284c7" />
            <path d="M5.5 16.2 10.6 8.4l2.9 4.5 1.8-2.6 3.2 5.9Z" fill="#fff" />
          </svg>
        );
      case 'arch':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#0ea5e9" />
            <path
              d="M12 5.4c-.9 2.3-2.5 5.6-5.2 11.4 1.7-.9 3.2-1.4 4.5-1.5-.1-1.2.4-2.3 1.2-2.3.8 0 1.3 1.1 1.2 2.3 1.3.1 2.8.6 4.5 1.5-2.7-5.8-4.3-9.1-6.2-11.4Z"
              fill="#fff"
            />
          </svg>
        );
      case 'fedora':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#2563eb" />
            <path
              d="M13.2 15.8V8.8a2.3 2.3 0 0 1 2.3-2.3c1 0 1.8.6 1.8 1.5M9.5 12h6.4m-6.4 0a2.3 2.3 0 1 0 2.3 2.3"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'suse':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#16a34a" />
            <path
              d="M6.8 14.4c1.3-3.4 4.5-5.4 8.5-4.8 1.2.2 2.1 1 2.1 2.1 0 1.4-1.3 2.3-2.9 2.3H9.5"
              fill="none"
              stroke="#fff"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <circle cx="14.5" cy="11.5" r="1.1" fill="#fff" />
          </svg>
        );
      case 'macos':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#475569" />
            <path
              d="M14.7 12.6c0-1.6 1.3-2.4 1.4-2.5-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6-.5 0-1.3-.6-2.2-.6-1.1 0-2.2.7-2.8 1.7-1.2 2-.3 5.1.8 6.7.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.2-.5 1 0 1.3.5 2.2.5.9 0 1.5-.8 2-1.6.6-.9.9-1.8.9-1.8 0 0-1.7-.7-1.7-2.9ZM13 7.5c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-.9Z"
              fill="#fff"
            />
          </svg>
        );
      case 'windows':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5" fill="#0284c7" />
            <path
              d="M6.2 7.2 11.4 6.5v5.1H6.2Zm6.2-.8L17.8 5.6v6H12.4ZM6.2 12.6h5.2v5l-5.2-.7Zm6.2 0h5.4v5.8l-5.4-.8Z"
              fill="#fff"
            />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="10.5" fill="#0f766e" />
            <path
              d="M7.6 9.3 10.7 12l-3.1 2.7M12.2 14.8h4.2"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
    }
  },
);
OsDistroIcon.displayName = 'OsDistroIcon';

/** Multi-tone layered protocol SVG icons shared across sidebar, tabs, menus, and cards. */
export const ProtocolIcon: React.FC<{ type: ProtocolIconType; size?: number }> = React.memo(
  ({ type, size = 16 }) => {
    switch (type) {
      case 'ssh':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <rect x="2.5" y="3" width="17" height="7" rx="2" fill="#059669" />
            <rect x="2.5" y="12" width="17" height="7" rx="2" fill="#10b981" />
            <rect
              x="3.5"
              y="3.8"
              width="15"
              height="1.2"
              rx="0.6"
              fill="#6ee7b7"
              fillOpacity="0.45"
            />
            <circle cx="6.2" cy="6.5" r="1.15" fill="#a7f3d0" />
            <circle cx="6.2" cy="15.5" r="1.15" fill="#ecfdf5" />
            <rect
              x="11.2"
              y="5.7"
              width="5.5"
              height="1.6"
              rx="0.8"
              fill="#022c22"
              fillOpacity="0.45"
            />
            <rect
              x="11.2"
              y="14.7"
              width="5.5"
              height="1.6"
              rx="0.8"
              fill="#022c22"
              fillOpacity="0.45"
            />
          </svg>
        );
      case 'localshell':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <rect x="2.2" y="3.2" width="17.6" height="15.6" rx="3" fill="#d97706" />
            <rect
              x="3.4"
              y="6.2"
              width="15.2"
              height="11.4"
              rx="1.8"
              fill="#1c1917"
              fillOpacity="0.82"
            />
            <circle cx="5.2" cy="4.7" r="0.7" fill="#fef3c7" />
            <circle cx="7.4" cy="4.7" r="0.7" fill="#fde68a" />
            <path
              d="M6.4 9.5 9.2 11.8 6.4 14.1M11 14.1h4.2"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'docker':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <rect x="5" y="9.2" width="3.2" height="2.8" rx="0.6" fill="#38bdf8" />
            <rect x="9" y="9.2" width="3.2" height="2.8" rx="0.6" fill="#38bdf8" />
            <rect x="13" y="9.2" width="3.2" height="2.8" rx="0.6" fill="#38bdf8" />
            <rect x="9" y="5.6" width="3.2" height="2.8" rx="0.6" fill="#7dd3fc" />
            <rect x="13" y="5.6" width="3.2" height="2.8" rx="0.6" fill="#7dd3fc" />
            <path
              d="M2.6 13.1h14.6c.7 0 1.4-.4 1.9-1 .4.9.5 2-.1 3-1.2 2.2-3.9 3.5-7.4 3.5-4.7 0-8.6-2-9-5.5Z"
              fill="#0284c7"
            />
            <circle cx="6.2" cy="15.2" r="0.9" fill="#e0f2fe" />
          </svg>
        );
      case 'serial':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <path
              d="M7.5 2.8v2.6m3.5-2.6v2.6m3.5-2.6v2.6M7.5 16.6v2.6m3.5-2.6v2.6m3.5-2.6v2.6M2.8 8.2h2.6m-2.6 5.6h2.6m11.2-5.6h2.6m-2.6 5.6h2.6"
              stroke="#c084fc"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <rect x="5.4" y="5.4" width="11.2" height="11.2" rx="2.4" fill="#9333ea" />
            <rect
              x="8.2"
              y="8.2"
              width="5.6"
              height="5.6"
              rx="1.1"
              fill="#e9d5ff"
              fillOpacity="0.88"
            />
          </svg>
        );
      case 'quickconnect':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="18" height="18" rx="5" fill="#f59e0b" fillOpacity="0.18" />
            <path d="M12.4 3.8 5.6 12.2h4.9l-.9 6 6.8-8.4h-4.9l.9-6Z" fill="#f59e0b" />
          </svg>
        );
      case 'tunnel':
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <path
              d="M6.5 11h9M12.5 8l3 3-3 3"
              fill="none"
              stroke="#2dd4bf"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="5.2" cy="11" r="2.7" fill="#0d9488" />
            <circle cx="16.8" cy="11" r="2.7" fill="#14b8a6" />
          </svg>
        );
      default:
        return (
          <svg
            className="proto-svg"
            width={size}
            height={size}
            viewBox="0 0 22 22"
            aria-hidden="true"
          >
            <rect x="2.6" y="4" width="16.8" height="11.4" rx="2.2" fill="#6366f1" />
            <rect
              x="4.2"
              y="5.6"
              width="13.6"
              height="8.2"
              rx="1.2"
              fill="#e0e7ff"
              fillOpacity="0.22"
            />
            <path
              d="M8 18.2h6M11 15.4v2.8"
              stroke="#818cf8"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        );
    }
  },
);
ProtocolIcon.displayName = 'ProtocolIcon';

/** Two-tone mini folder for sidebar session groups (visually opens when expanded). */
export const GroupFolderIcon: React.FC<{ expanded: boolean; size?: number }> = React.memo(
  ({ expanded, size = 15 }) => (
    <svg
      className="group-folder-svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        d="M2.2 5.2c0-.95.77-1.7 1.72-1.7h3.4c.54 0 1.04.25 1.36.68l.66.88c.17.22.43.35.71.35h6.03c.95 0 1.72.76 1.72 1.7v7.9c0 .98-.8 1.79-1.78 1.79H3.98c-.98 0-1.78-.8-1.78-1.79V5.2Z"
        fill="#d97706"
      />
      {expanded ? (
        <path
          d="M2.2 8.2c0-.88.72-1.6 1.6-1.6h12.4c.88 0 1.6.72 1.6 1.6l-.9 7c-.12.92-.9 1.6-1.82 1.6H4.92c-.92 0-1.7-.68-1.82-1.6l-.9-7Z"
          fill="#fbbf24"
        />
      ) : (
        <rect x="2.2" y="6.8" width="15.6" height="10" rx="1.8" fill="#fbbf24" />
      )}
    </svg>
  ),
);
GroupFolderIcon.displayName = 'GroupFolderIcon';

/** Soft layered vector illustrations for empty sidebars & unassigned split slots. */
export const EmptyIllustration: React.FC<{
  variant: 'hosts' | 'snippets' | 'split';
  size?: number;
}> = React.memo(({ variant, size = 48 }) => {
  if (variant === 'hosts') {
    return (
      <svg
        className="empty-illus-svg"
        width={size}
        height={size}
        viewBox="0 0 56 56"
        aria-hidden="true"
      >
        <circle cx="28" cy="28" r="24" fill="var(--accent-primary)" fillOpacity="0.08" />
        <rect
          x="13"
          y="15"
          width="30"
          height="11"
          rx="3"
          fill="var(--bg-card)"
          stroke="var(--border-light)"
          strokeWidth="1.2"
        />
        <rect
          x="13"
          y="30"
          width="30"
          height="11"
          rx="3"
          fill="var(--bg-card)"
          stroke="var(--border-light)"
          strokeWidth="1.2"
        />
        <circle cx="19" cy="20.5" r="2.1" fill="var(--accent-primary)" />
        <circle cx="19" cy="35.5" r="2.1" fill="var(--text-muted)" fillOpacity="0.5" />
        <rect
          x="25"
          y="19.3"
          width="13"
          height="2.4"
          rx="1.2"
          fill="var(--text-muted)"
          fillOpacity="0.4"
        />
        <rect
          x="25"
          y="34.3"
          width="10"
          height="2.4"
          rx="1.2"
          fill="var(--text-muted)"
          fillOpacity="0.3"
        />
      </svg>
    );
  }
  if (variant === 'snippets') {
    return (
      <svg
        className="empty-illus-svg"
        width={size}
        height={size}
        viewBox="0 0 56 56"
        aria-hidden="true"
      >
        <circle cx="28" cy="28" r="24" fill="var(--accent-primary)" fillOpacity="0.08" />
        <rect
          x="12"
          y="14"
          width="32"
          height="28"
          rx="4"
          fill="var(--bg-card)"
          stroke="var(--border-light)"
          strokeWidth="1.2"
        />
        <path
          d="M18 23l4 3.5-4 3.5"
          fill="none"
          stroke="var(--accent-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="25"
          y="28.5"
          width="12"
          height="2.2"
          rx="1.1"
          fill="var(--text-muted)"
          fillOpacity="0.45"
        />
        <rect
          x="18"
          y="34.5"
          width="16"
          height="2"
          rx="1"
          fill="var(--text-muted)"
          fillOpacity="0.28"
        />
      </svg>
    );
  }
  return (
    <svg
      className="empty-illus-svg"
      width={size}
      height={size}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <circle cx="28" cy="28" r="24" fill="var(--accent-primary)" fillOpacity="0.07" />
      <rect
        x="10"
        y="14"
        width="36"
        height="28"
        rx="4"
        fill="var(--bg-card)"
        stroke="var(--border-light)"
        strokeWidth="1.2"
      />
      <line
        x1="28"
        y1="14"
        x2="28"
        y2="42"
        stroke="var(--border-light)"
        strokeWidth="1.2"
        strokeDasharray="3 2.5"
      />
      <path
        d="M15 24l3 2.6-3 2.6"
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M34 28h6m-3-3v6"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
});
EmptyIllustration.displayName = 'EmptyIllustration';
