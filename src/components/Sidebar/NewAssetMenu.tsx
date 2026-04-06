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

interface NewAssetMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (type: string) => void;
}

const remoteItems = [
  { id: 'ssh', icon: TerminalSquare, label: 'SSH' },
  { id: 'ssh-tunnel', icon: Network, label: 'SSH 隧道' },
  { id: 'rdp', icon: Monitor, label: 'RDP' },
  { id: 'telnet', icon: Cable, label: 'Telnet' },
  { id: 'serial', icon: Usb, label: '串口' },
];

const menuItems = [
  { id: 'directory', icon: FolderPlus, label: '目录' },
  { id: 'localshell', icon: TerminalSquare, label: '本地终端' },
  { id: 'docker', icon: Box, label: 'Docker' },
  { id: 'remote', icon: Monitor, label: '远程连接', hasSubmenu: true },
  { id: 'database', icon: Database, label: '数据库' },
];

export const NewAssetMenu: React.FC<NewAssetMenuProps> = ({ anchorRef, onClose, onSelect }) => {
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
            <span>{item.label}</span>
            {item.hasSubmenu && (
              <span className="new-asset-menu-arrow"><ChevronRight size={13} /></span>
            )}
          </div>
        ))}

        {/* Remote submenu */}
        {hoveredItem === 'remote' && submenuPos && (
          <div
            className="new-asset-submenu"
            style={{ top: submenuPos.top, left: submenuPos.left }}
            onMouseEnter={() => setHoveredItem('remote')}
            onMouseLeave={() => setHoveredItem(null)}
          >
            {remoteItems.map((item) => (
              <div
                key={item.id}
                className="new-asset-menu-item"
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <span className="new-asset-menu-icon"><item.icon size={15} /></span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
