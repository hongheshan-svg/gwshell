import React, { useState, useRef, useEffect } from 'react';
import {
  FolderPlus,
  TerminalSquare,
  Box,
  Monitor,
  Database,
  ChevronRight,
  Network,
  Cable,
  Usb,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TranslationKeys } from '../../i18n';

interface NewAssetMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (type: string) => void;
}

const remoteItems: { id: string; icon: typeof TerminalSquare; labelKey: TranslationKeys }[] = [
  { id: 'ssh', icon: TerminalSquare, labelKey: 'newasset_ssh' },
  { id: 'ssh-tunnel', icon: Network, labelKey: 'newasset_ssh_tunnel' },
  { id: 'rdp', icon: Monitor, labelKey: 'newasset_rdp' },
  { id: 'telnet', icon: Cable, labelKey: 'newasset_telnet' },
  { id: 'serial', icon: Usb, labelKey: 'newasset_serial' },
];

const menuItems: { id: string; icon: typeof FolderPlus; labelKey: TranslationKeys; hasSubmenu?: boolean }[] = [
  { id: 'directory', icon: FolderPlus, labelKey: 'newasset_directory' },
  { id: 'localshell', icon: TerminalSquare, labelKey: 'newasset_localshell' },
  { id: 'docker', icon: Box, labelKey: 'newasset_docker' },
  { id: 'remote', icon: Monitor, labelKey: 'newasset_remote', hasSubmenu: true },
  { id: 'database', icon: Database, labelKey: 'newasset_database' },
];

export const NewAssetMenu: React.FC<NewAssetMenuProps> = ({ anchorRef, onClose, onSelect }) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);

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
      setSubmenuPos({ top: rect.top, left: rect.right + 4 });
    }
  };

  const handleItemMouseLeave = () => {
    // Don't immediately clear - let submenu handle it
  };

  return (
    <div className="new-asset-menu-overlay" onClick={onClose}>
      <div
        ref={menuRef}
        className="new-asset-menu"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`new-asset-menu-item ${hoveredItem === item.id ? 'hovered' : ''}`}
            onClick={() => {
              if (!item.hasSubmenu) {
                onSelect(item.id);
                onClose();
              }
            }}
            onMouseEnter={(e) => handleItemMouseEnter(item.id, e)}
            onMouseLeave={handleItemMouseLeave}
          >
            <span className="new-asset-menu-icon"><item.icon size={15} /></span>
            <span>{t(item.labelKey)}</span>
            {item.hasSubmenu && <span className="new-asset-menu-arrow"><ChevronRight size={14} /></span>}
          </div>
        ))}

        {/* Submenu for remote */}
        {hoveredItem === 'remote' && submenuPos && (
          <div
            className="new-asset-submenu"
            style={{ top: submenuPos.top, left: submenuPos.left }}
          >
            {remoteItems.map((item) => (
              <div
                key={item.id}
                className="new-asset-menu-item"
                onClick={() => { onSelect(item.id); onClose(); }}
              >
                <span className="new-asset-menu-icon"><item.icon size={15} /></span>
                <span>{t(item.labelKey)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
