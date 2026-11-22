import React from 'react';
import { X } from 'lucide-react';

export interface ModalTabItem {
  id: string;
  label: string;
}

interface SessionModalShellProps {
  title: string;
  tabs: ModalTabItem[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}

export const SessionModalShell: React.FC<SessionModalShellProps> = ({
  title,
  tabs,
  activeTab,
  onSelectTab,
  onClose,
  footer,
  children,
}) => (
  <div
    className="modal-overlay"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
      <div className="ssh-modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="ssh-modal-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`ssh-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ssh-modal-body">{children}</div>

      <div className="ssh-modal-footer">{footer}</div>
    </div>
  </div>
);
