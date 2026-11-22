// src/components/Terminal/FingerprintDialog.tsx
// SSH host-key fingerprint verification dialog overlay.
// Shows a distinct warning when the host presents a different key type than pinned.

import { useTranslation } from 'react-i18next';
import type { FingerprintInfo } from './types';

interface FingerprintDialogProps {
  info: FingerprintInfo;
  onAccept: () => void;
  onReject: () => void;
}

export function FingerprintDialog({ info, onAccept, onReject }: FingerprintDialogProps) {
  const { t } = useTranslation();
  const keyTypeChanged = !!info.knownKeyType;
  return (
    <div className="fingerprint-overlay">
      <div className="fingerprint-dialog">
        <div className="fingerprint-dialog-title">
          {keyTypeChanged ? '⚠️' : '🔒'} {t(keyTypeChanged ? 'fp_keytype_title' : 'fp_title')}
        </div>
        <div className="fingerprint-dialog-body">
          {keyTypeChanged ? (
            <p className="fingerprint-warning">
              {t('fp_keytype_desc', { known: info.knownKeyType, current: info.keyType })}
            </p>
          ) : (
            <p>{t('fp_desc')}</p>
          )}
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
            {t(keyTypeChanged ? 'fp_keytype_accept' : 'fp_accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
