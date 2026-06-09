import React, { useState, useRef, useEffect } from 'react';
import {
  TerminalSquare,
  Box,
  Monitor,
  ChevronRight,
  Network,
  Usb,
  Server,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEscapeClose } from '../../lib/useEscapeClose';
import type { TranslationKeys } from '../../i18n';

interface NewAssetMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (type: string) => void;
}

// Niche remote types kept under a submenu (disabled placeholders like RDP/Telnet
// are hidden rather than shown as dead "unavailable" rows).
const remoteItems: { id: string; icon: typeof TerminalSquare; labelKey: TranslationKeys; disabled?: boolean }[] = [
  { id: 'ssh-tunnel', icon: Network, labelKey: 'newasset_ssh_tunnel' },
  { id: 'serial', icon: Usb, labelKey: 'newasset_serial' },
];

// SSH is the app's core action, so it leads as a one-click top-level item rather
// than being buried in the remote submenu. Unimplemented entries are omitted.
const menuItems: { id: string; icon: typeof TerminalSquare; labelKey: TranslationKeys; hasSubmenu?: boolean; disabled?: boolean }[] = [
  { id: 'quickconnect', icon: Zap, labelKey: 'newasset_quickconnect' },
  { id: 'ssh', icon: Server, labelKey: 'newasset_ssh' },
  { id: 'localshell', icon: TerminalSquare, labelKey: 'newasset_localshell' },
  { id: 'docker', icon: Box, labelKey: 'newasset_docker' },
  { id: 'remote', icon: Monitor, labelKey: 'newasset_remote', hasSubmenu: true },
];

export const NewAssetMenu: React.FC<NewAssetMenuProps> = ({ anchorRef, onClose, onSelect }) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);

  useEscapeClose(onClose);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Calculate position based on anchor
  const getMenuPosition = () => {
    if (!anchorRef.current) return { top: 100, left: 60 };
    const rect = anchorRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left };
  };

  const pos = getMenuPosition();

  const handleItemMouseEnter = (itemId: string, e: React.MouseEvent) => {
    setHoveredItem(itemId);
    if (itemId === 'remote') {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      // Flush against the panel's right edge (no gap). The submenu is a DOM child
      // of .new-asset-menu, so a flush position lets the cursor move from the
      // Remote row into the submenu without crossing a dead zone over the overlay
      // (which would fire the panel's onMouseLeave and collapse the submenu).
      setSubmenuPos({ top: rect.top, left: rect.right });
    }
  };

  return (
    <div className="new-asset-menu-overlay" onClick={onClose}>
      <div
        ref={menuRef}
        className="new-asset-menu"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
        // Clear the submenu when the cursor leaves the entire menu panel
        // (covers the gap between the remote row and the submenu itself).
        onMouseLeave={() => setHoveredItem(null)}
      >
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`new-asset-menu-item ${hoveredItem === item.id ? 'hovered' : ''}`}
            aria-disabled={item.disabled}
            style={item.disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
            onClick={() => {
              if (!item.disabled && !item.hasSubmenu) {
                onSelect(item.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleItemMouseEnter(item.id, e)}
          >
            <span className="new-asset-menu-icon"><item.icon size={15} /></span>
            <span>{t(item.labelKey)}</span>
            {item.disabled && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                {t('common_unavailable')}
              </span>
            )}
            {item.hasSubmenu && <span className="new-asset-menu-arrow"><ChevronRight size={14} /></span>}
          </div>
        ))}

        {/* Submenu for remote. It is a DOM child of .new-asset-menu and positioned
            flush against the panel's right edge, so moving the cursor from the
            Remote row into it stays within the panel's subtree and does not fire
            the panel's onMouseLeave. onMouseEnter re-pins 'remote' as a safety net. */}
        {hoveredItem === 'remote' && submenuPos && (
          <div
            className="new-asset-submenu"
            style={{ top: submenuPos.top, left: submenuPos.left }}
            onMouseEnter={() => setHoveredItem('remote')}
          >
            {remoteItems.map((item) => (
              <div
                key={item.id}
                className="new-asset-menu-item"
                aria-disabled={item.disabled}
                style={item.disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  onSelect(item.id);
                  onClose();
                }}
              >
                <span className="new-asset-menu-icon"><item.icon size={15} /></span>
                <span>{t(item.labelKey)}</span>
                {item.disabled && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('common_unavailable')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
