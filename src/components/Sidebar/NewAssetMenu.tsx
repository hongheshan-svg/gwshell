import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEscapeClose } from '../../lib/useEscapeClose';
import type { TranslationKeys } from '../../i18n';
import { ProtocolIcon, type ProtocolIconType } from '../Icons/BrandIcons';

interface NewAssetMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (type: string) => void;
}

// Niche remote types kept under a submenu (disabled placeholders like RDP/Telnet
// are hidden rather than shown as dead "unavailable" rows).
const remoteItems: {
  id: string;
  icon: ProtocolIconType;
  labelKey: TranslationKeys;
  disabled?: boolean;
}[] = [
  { id: 'ssh-tunnel', icon: 'tunnel', labelKey: 'newasset_ssh_tunnel' },
  { id: 'serial', icon: 'serial', labelKey: 'newasset_serial' },
];

// SSH is the app's core action, so it leads as a one-click top-level item rather
// than being buried in the remote submenu. Unimplemented entries are omitted.
const menuItems: {
  id: string;
  icon: ProtocolIconType;
  labelKey: TranslationKeys;
  hasSubmenu?: boolean;
  disabled?: boolean;
}[] = [
  { id: 'quickconnect', icon: 'quickconnect', labelKey: 'newasset_quickconnect' },
  { id: 'ssh', icon: 'ssh', labelKey: 'newasset_ssh' },
  { id: 'localshell', icon: 'localshell', labelKey: 'newasset_localshell' },
  { id: 'docker', icon: 'docker', labelKey: 'newasset_docker' },
  { id: 'remote', icon: 'remote', labelKey: 'newasset_remote', hasSubmenu: true },
];

export const NewAssetMenu: React.FC<NewAssetMenuProps> = ({ anchorRef, onClose, onSelect }) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [submenuTop, setSubmenuTop] = useState<number>(0);

  useEscapeClose(onClose);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // eslint-disable-next-line no-restricted-syntax
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Calculate viewport-clamped position based on anchor.
  const MENU_EST_WIDTH = 190;
  const SUBMENU_EST_WIDTH = 168;
  const VIEWPORT_PAD = 10;

  const getMenuPosition = () => {
    if (!anchorRef.current) return { top: 100, left: 60, openSubmenuLeft: false };
    const rect = anchorRef.current.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - MENU_EST_WIDTH - VIEWPORT_PAD);
    const left = Math.min(Math.max(VIEWPORT_PAD, rect.left), maxLeft);
    const openSubmenuLeft =
      left + MENU_EST_WIDTH + SUBMENU_EST_WIDTH > window.innerWidth - VIEWPORT_PAD;
    return { top: rect.bottom + 4, left, openSubmenuLeft };
  };

  const pos = getMenuPosition();

  const handleItemMouseEnter = (itemId: string, e: React.MouseEvent) => {
    setHoveredItem(itemId);
    if (itemId === 'remote') {
      const target = e.currentTarget as HTMLElement; // eslint-disable-line no-restricted-syntax -- DOM EventTarget narrowing; offsetTop needs HTMLElement
      setSubmenuTop(target.offsetTop);
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
            <span className="new-asset-menu-icon">
              <ProtocolIcon type={item.icon} size={17} />
            </span>
            <span>{t(item.labelKey)}</span>
            {item.disabled && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                {t('common_unavailable')}
              </span>
            )}
            {item.hasSubmenu && (
              <span className="new-asset-menu-arrow">
                <ChevronRight size={14} />
              </span>
            )}
          </div>
        ))}

        {/* Submenu for remote — positioned absolute relative to .new-asset-menu
            so backdrop-filter containing blocks never offset it, and flips to
            the left when anchored near the viewport's right edge. */}
        {hoveredItem === 'remote' && (
          <div
            className="new-asset-submenu"
            style={
              pos.openSubmenuLeft
                ? { top: submenuTop, right: '100%', left: 'auto' }
                : { top: submenuTop, left: '100%' }
            }
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
                <span className="new-asset-menu-icon">
                  <ProtocolIcon type={item.icon} size={17} />
                </span>
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
