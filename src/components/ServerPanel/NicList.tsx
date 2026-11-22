import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Network } from 'lucide-react';
import type { NicInfo } from '../../types/serverMetrics';
import { writeClipboardText } from '../../lib/terminalClipboard';

interface Props {
  nics: NicInfo[] | null;
}

export const NicList: React.FC<Props> = ({ nics }) => {
  const { t } = useTranslation();
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const handleCopy = (ip: string) => {
    void writeClipboardText(ip).then(() => {
      setCopiedIp(ip);
      window.setTimeout(() => setCopiedIp((cur) => (cur === ip ? null : cur)), 1400);
    });
  };

  return (
    <div className="sp-card">
      <div className="sp-card__header">
        <div className="sp-card__title">
          <span className="sp-card__icon sp-card__icon--nic">
            <Network size={12} />
          </span>
          <span>{t('serverPanel_nic_title')}</span>
          {nics && nics.length > 0 && <span className="sp-count-pill">{nics.length}</span>}
        </div>
      </div>

      {!nics || nics.length === 0 ? (
        <div className="sp-empty">{t('serverPanel_nic_empty')}</div>
      ) : (
        <div className="sp-nic-list">
          {nics.map((n) => (
            <div key={`${n.name}-${n.ipv4 ?? ''}`} className="sp-nic-item">
              <div className="sp-nic-top">
                <span className="sp-nic-name">{n.name}</span>
                {n.ipv4 ? (
                  <button
                    type="button"
                    className="sp-nic-ip-btn"
                    onClick={() => handleCopy(n.ipv4 ?? '')}
                    title={t('serverPanel_nic_copied')}
                  >
                    <code>{n.ipv4}</code>
                    {copiedIp === n.ipv4 ? (
                      <Check size={11} className="is-ok" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                ) : (
                  <span className="sp-nic-none">—</span>
                )}
              </div>
              {n.mac && (
                <div className="sp-nic-mac">
                  <span>{t('serverPanel_nic_mac')}</span>
                  <code>{n.mac}</code>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
