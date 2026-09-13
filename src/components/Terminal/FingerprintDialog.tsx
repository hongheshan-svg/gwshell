// src/components/Terminal/FingerprintDialog.tsx
// SSH host-key fingerprint verification dialog overlay.
// Extracted from TerminalView.tsx - pure JSX move, no logic changes.

import { useTranslation } from 'react-i18next';
import type { FingerprintInfo } from './types';

interface FingerprintDialogProps {
  info: FingerprintInfo;
  onAccept: () => void;
  onReject: () => void;
}

export function FingerprintDialog({ info, onAccept, onReject }: FingerprintDialogProps) {
  const { t } = useTranslation();
  return (
    <div className="fingerprint-overlay">
      <div className="fingerprint-dialog">
        <div className="fingerprint-dialog-title">🔒 {t('fp_title')}</div>
        <div className="fingerprint-dialog-body">
          <p>{t('fp_desc')}</p>
          <div className="fingerprint-host">
            {info.host}:{info.port}
          </div>
          <div className="fingerprint-hash">
            <span className="fingerprint-label">{info.keyType}</span>
            <code>{info.fingerprint}</code>
          </div>
          <p className="fingerprint-warning">{t('fp_warning')}</p>
        </div>
        <div className="fingerprint-dialog-footer">
          <button className="fingerprint-btn fingerprint-btn-reject" onClick={onReject}>
            {t('fp_reject')}
          </button>
          <button className="fingerprint-btn fingerprint-btn-accept" onClick={onAccept}>
            {t('fp_accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
