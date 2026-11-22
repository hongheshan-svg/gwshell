import React from 'react';
import {
  PARENT_FOLDER_VISUAL,
  resolveFileVisual,
  resolveFolderVisual,
  type FileVisual,
  type FolderVisual,
} from '../../lib/fileIcons';

interface SftpEntryIconProps {
  kind: 'folder' | 'parent' | 'file';
  name: string;
}

const FolderEmblem: React.FC<{ badge: FolderVisual['badge']; color: string }> = ({
  badge,
  color,
}) => {
  switch (badge) {
    case 'parent':
      return (
        <path
          d="M11.2 14.2H13c1.1 0 1.8-.7 1.8-1.7 0-.9-.7-1.6-1.8-1.6H9.6m0 0 1.6-1.6M9.6 10.9l1.6 1.6"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'ssh':
      return (
        <g
          fill="none"
          stroke={color}
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect
            x="8.6"
            y="11.6"
            width="4.8"
            height="3.6"
            rx="0.9"
            fill={color}
            fillOpacity="0.22"
          />
          <path d="M9.7 11.6v-1a1.3 1.3 0 0 1 2.6 0v1" />
        </g>
      );
    case 'git':
      return (
        <g fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round">
          <circle cx="9.2" cy="10.8" r="1" fill={color} />
          <circle cx="9.2" cy="14.7" r="1" fill={color} />
          <circle cx="13.2" cy="12.2" r="1" fill={color} />
          <path d="M9.2 11.8v1.9M12.3 12.2H10.5c-.7 0-1.3.4-1.3 1" />
        </g>
      );
    case 'config':
      return (
        <g fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round">
          <circle cx="11" cy="12.8" r="1.7" />
          <path d="M11 9.9v.9m0 4v.9m2.9-2.9h-.9m-4 0h-.9m4.1-2-.6.6m-3.1 3.1-.6.6m4.3 0-.6-.6m-3.1-3.1-.6-.6" />
        </g>
      );
    case 'code':
      return (
        <path
          d="M9.5 11.2 7.8 12.8l1.7 1.6m3-3.2 1.7 1.6-1.7 1.6"
          fill="none"
          stroke={color}
          strokeWidth="1.45"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'docker':
      return (
        <g fill={color} fillOpacity="0.88">
          <rect x="7.8" y="12.2" width="1.9" height="1.6" rx="0.3" />
          <rect x="10.2" y="12.2" width="1.9" height="1.6" rx="0.3" />
          <rect x="12.6" y="12.2" width="1.9" height="1.6" rx="0.3" />
          <rect x="10.2" y="10.2" width="1.9" height="1.6" rx="0.3" />
        </g>
      );
    case 'package':
      return (
        <g fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round">
          <path d="M11 10l2.7 1.4v2.8L11 15.6l-2.7-1.4v-2.8L11 10Z" />
          <path d="M8.3 11.4 11 12.8l2.7-1.4M11 12.8v2.8" />
        </g>
      );
    case 'log':
      return (
        <path
          d="M8.4 11.2h5.2M8.4 13h4.2M8.4 14.8h3"
          fill="none"
          stroke={color}
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      );
    case 'home':
      return (
        <path
          d="M8.2 12.7 11 10.3l2.8 2.4M9.1 12.2v2.9h3.8v-2.9"
          fill="none"
          stroke={color}
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    default:
      return null;
  }
};

const FolderSvg: React.FC<{ visual: FolderVisual }> = ({ visual }) => (
  <svg
    className="sftp-entry-svg sftp-entry-svg--folder"
    width="20"
    height="20"
    viewBox="0 0 22 22"
    aria-hidden="true"
    style={visual.dimmed ? { opacity: 0.78 } : undefined}
  >
    {/* Back tab plate */}
    <path
      d="M2.2 5.4c0-1.05.85-1.9 1.9-1.9h4.1c.6 0 1.16.28 1.52.76l.74 1c.19.25.49.4.8.4h6.64c1.05 0 1.9.85 1.9 1.9v8.8c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2V5.4Z"
      fill={visual.back}
    />
    {/* Front rounded flap */}
    <rect x="2.2" y="7.1" width="17.6" height="11.2" rx="2.1" fill={visual.front} />
    {/* Subtle top bevel highlight for tactile depth */}
    <path
      d="M4.3 7.65h13.4c.88 0 1.6.68 1.6 1.55v.25c0-.66-.56-1.15-1.25-1.15H3.95c-.69 0-1.25.49-1.25 1.15v-.25c0-.87.72-1.55 1.6-1.55Z"
      fill={visual.highlight}
      fillOpacity="0.65"
    />
    {/* Bottom subtle rim shadow */}
    <path
      d="M2.4 16.5c.25.95 1.02 1.65 1.95 1.65h13.3c.93 0 1.7-.7 1.95-1.65v.3c0 .95-.78 1.7-1.75 1.7H4.15c-.97 0-1.75-.75-1.75-1.7v-.3Z"
      fill="#000"
      fillOpacity="0.16"
    />
    <FolderEmblem badge={visual.badge} color={visual.emblem} />
  </svg>
);

const FileGlyph: React.FC<{ visual: FileVisual }> = ({ visual }) => {
  switch (visual.glyph) {
    case 'badge': {
      const text = visual.badge ?? '';
      const fontSize = text.length >= 3 ? 5.3 : 6.1;
      return (
        <g>
          <rect x="3" y="10.4" width="14.2" height="7" rx="2" fill={visual.accent} />
          <text
            x="10.1"
            y="15.55"
            textAnchor="middle"
            fill={visual.badgeFg ?? '#ffffff'}
            fontSize={fontSize}
            fontWeight="800"
            fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
            letterSpacing="-0.03em"
          >
            {text}
          </text>
        </g>
      );
    }
    case 'shell':
      return (
        <g>
          <rect x="3" y="10.2" width="14.2" height="7.2" rx="2" fill={visual.accent} />
          <path
            d="M5.8 12.1 7.8 13.8 5.8 15.5M9.2 15.5h3.2"
            fill="none"
            stroke="#022c22"
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case 'json':
      return (
        <g>
          <rect x="3" y="10.2" width="14.2" height="7.2" rx="2" fill={visual.accent} />
          <text
            x="10.1"
            y="15.65"
            textAnchor="middle"
            fill="#1c1917"
            fontSize="6.6"
            fontWeight="800"
            fontFamily="JetBrains Mono, ui-monospace, monospace"
          >
            {'{}'}
          </text>
        </g>
      );
    case 'docker':
      return (
        <g fill={visual.accent}>
          <rect x="6.1" y="13.2" width="2.5" height="2.1" rx="0.4" />
          <rect x="9.1" y="13.2" width="2.5" height="2.1" rx="0.4" />
          <rect x="12.1" y="13.2" width="2.5" height="2.1" rx="0.4" />
          <rect x="9.1" y="10.7" width="2.5" height="2.1" rx="0.4" />
          <path
            d="M5.4 16.2h10.2c-.3 1.1-1.3 1.8-2.6 1.8H8c-1.3 0-2.3-.7-2.6-1.8Z"
            fillOpacity="0.72"
          />
        </g>
      );
    case 'image':
      return (
        <g>
          <rect
            x="5.6"
            y="10"
            width="10.6"
            height="7.4"
            rx="1.5"
            fill={visual.accent}
            fillOpacity="0.2"
            stroke={visual.accent}
            strokeWidth="1.2"
          />
          <circle cx="8.4" cy="12.3" r="1.05" fill={visual.accent} />
          <path
            d="M6.4 16.6 9.6 13.4l2.1 2.1 1.4-1.3 2.3 2.4Z"
            fill={visual.accent}
            fillOpacity="0.9"
          />
        </g>
      );
    case 'archive':
      return (
        <g>
          <rect
            x="8.7"
            y="3.6"
            width="3.2"
            height="14.2"
            rx="0.8"
            fill={visual.accent}
            fillOpacity="0.22"
          />
          <rect x="9.1" y="5.2" width="1.2" height="1.2" rx="0.2" fill={visual.accent} />
          <rect x="10.3" y="6.8" width="1.2" height="1.2" rx="0.2" fill={visual.accent} />
          <rect x="9.1" y="8.4" width="1.2" height="1.2" rx="0.2" fill={visual.accent} />
          <rect x="10.3" y="10" width="1.2" height="1.2" rx="0.2" fill={visual.accent} />
          <rect x="8.6" y="12.2" width="3.4" height="3.2" rx="0.8" fill={visual.accent} />
        </g>
      );
    case 'key':
      return (
        <g
          fill="none"
          stroke={visual.accent}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8.6" cy="14" r="2.1" fill={visual.accent} fillOpacity="0.2" />
          <path d="M10.7 14h4.7m-1.4 0v1.6m-1.8-1.6v1.2" />
        </g>
      );
    case 'video':
      return (
        <g>
          <rect
            x="5.6"
            y="10.2"
            width="10.6"
            height="7.2"
            rx="1.6"
            fill={visual.accent}
            fillOpacity="0.2"
            stroke={visual.accent}
            strokeWidth="1.2"
          />
          <path d="M9.6 12.1 13 13.8l-3.4 1.7Z" fill={visual.accent} />
        </g>
      );
    case 'audio':
      return (
        <g stroke={visual.accent} strokeWidth="1.5" strokeLinecap="round">
          <path d="M7.2 14.8v-2m2.2 3.2v-4.4m2.2 3.8v-3.2m2.2 2.4v-1.6" />
        </g>
      );
    case 'sheet':
      return (
        <g fill="none" stroke={visual.accent} strokeWidth="1.2">
          <rect
            x="6"
            y="10.4"
            width="9.8"
            height="6.8"
            rx="1.2"
            fill={visual.accent}
            fillOpacity="0.16"
          />
          <path d="M6 12.8h9.8M6 15h9.8M10.2 10.4v6.8" />
        </g>
      );
    case 'binary':
      return (
        <g fill="none" stroke={visual.accent} strokeWidth="1.25" strokeLinecap="round">
          <rect
            x="8.1"
            y="11"
            width="5.6"
            height="5.6"
            rx="1.1"
            fill={visual.accent}
            fillOpacity="0.2"
          />
          <path d="M9.7 9.6v1.4m2.4-1.4v1.4m-2.4 5.6V18m2.4-1.4V18M6.7 12.6h1.4m-1.4 2.4h1.4m5.6-2.4h1.4m-1.4 2.4h1.4" />
        </g>
      );
    case 'text':
      return (
        <path
          d="M7.1 11.4h7.4M7.1 13.9h7.4M7.1 16.4h4.8"
          fill="none"
          stroke={visual.accent}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      );
    default:
      return (
        <path
          d="M7.4 12.2h6.8M7.4 15h4.5"
          fill="none"
          stroke={visual.accent}
          strokeOpacity="0.65"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      );
  }
};

const FileSvg: React.FC<{ visual: FileVisual }> = ({ visual }) => (
  <svg
    className="sftp-entry-svg sftp-entry-svg--file"
    width="20"
    height="20"
    viewBox="0 0 22 22"
    aria-hidden="true"
    style={visual.dimmed ? { opacity: 0.78 } : undefined}
  >
    {/* Layered paper sheet with folded top-right dog-ear */}
    <path
      className="sftp-file-sheet"
      d="M5.4 2.4h7.5l4.5 4.5v11.1c0 1-.8 1.8-1.8 1.8H5.4c-1 0-1.8-.8-1.8-1.8V4.2c0-1 .8-1.8 1.8-1.8Z"
    />
    {/* Subtle accent tint wash inside paper */}
    <path
      d="M5.4 2.4h7.5l4.5 4.5v11.1c0 1-.8 1.8-1.8 1.8H5.4c-1 0-1.8-.8-1.8-1.8V4.2c0-1 .8-1.8 1.8-1.8Z"
      fill={visual.accent}
      fillOpacity="0.1"
      stroke={visual.accent}
      strokeOpacity="0.45"
      strokeWidth="1"
    />
    {/* Folded corner flap */}
    <path d="M12.9 2.4v3.3c0 .66.54 1.2 1.2 1.2h3.3Z" fill={visual.accent} fillOpacity="0.34" />
    <FileGlyph visual={visual} />
  </svg>
);

export const SftpEntryIcon: React.FC<SftpEntryIconProps> = React.memo(({ kind, name }) => {
  if (kind === 'parent') {
    return <FolderSvg visual={PARENT_FOLDER_VISUAL} />;
  }
  if (kind === 'folder') {
    return <FolderSvg visual={resolveFolderVisual(name)} />;
  }
  return <FileSvg visual={resolveFileVisual(name)} />;
});

SftpEntryIcon.displayName = 'SftpEntryIcon';
