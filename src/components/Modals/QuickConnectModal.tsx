import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { parseQuickConnect } from '../../lib/quickConnect';
import type { SessionConfig } from '../../types';

export const QuickConnectModal: React.FC = () => {
  const { t } = useTranslation();
  const { setShowQuickConnect, addTemporarySession, addTab } = useAppStore();
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const close = () => setShowQuickConnect(false);

  const connect = () => {
    const parsed = parseQuickConnect(target);
    if (!parsed) {
      setError(t('quickconnect_invalid'));
      return;
    }
    const id = crypto.randomUUID();
    const title = parsed.username ? `${parsed.username}@${parsed.host}` : parsed.host;
    const cfg: SessionConfig = {
      id,
      name: target.trim(),
      session_type: 'ssh',
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      auth_method: password ? 'password' : 'agent',
      password: password || undefined,
      _temporary: true,
    };
    addTemporarySession(cfg);
    addTab({ id: crypto.randomUUID(), sessionId: id, title, type: 'ssh', connected: false });
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); connect(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div className="quick-connect-overlay" onMouseDown={close}>
      <div className="quick-connect-card" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="quick-connect-title">{t('quickconnect_title')}</div>
        <input
          className="quick-connect-input"
          autoFocus
          placeholder={t('quickconnect_placeholder')}
          value={target}
          onChange={(e) => { setTarget(e.target.value); setError(''); }}
        />
        <input
          className="quick-connect-input"
          type="password"
          placeholder={t('quickconnect_password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="quick-connect-error">{error}</div>}
        <div className="quick-connect-actions">
          <button className="quick-connect-btn" onClick={close}>{t('quickconnect_cancel')}</button>
          <button className="quick-connect-btn primary" onClick={connect}>{t('quickconnect_connect')}</button>
        </div>
      </div>
    </div>
  );
};
