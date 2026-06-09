import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from 'lucide-react';
import type { DockerContainer } from '../../stores/appStore';

interface Props {
  containers: DockerContainer[];
  onPick: (id: string) => void;
  onCancel: () => void;
}

export const DockerContainerPicker: React.FC<Props> = ({ containers, onPick, onCancel }) => {
  const { t } = useTranslation('gwshell');
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, containers.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (containers[sel]) onPick(containers[sel].id); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [containers, sel, onPick, onCancel]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ssh-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-header"><h2>{t('docker_pick_container')}</h2></div>
        <div className="ssh-modal-body">
          {containers.map((c, i) => (
            <div
              key={c.id}
              className={`docker-pick-row${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onPick(c.id)}
            >
              <Box size={15} className="docker-pick-icon" />
              <span className="docker-pick-name">{c.name}</span>
              <span className="docker-pick-image">{c.image}</span>
              <span className="docker-pick-status">{c.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
