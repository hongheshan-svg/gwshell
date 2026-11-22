import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useUpdaterStore } from '../../stores/updaterStore';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { formatReleaseDate, formatUpdateBytes } from '../../lib/updaterUtils';
import './UpdateModal.css';

export const UpdateModal: React.FC = () => {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const currentVersion = useUpdaterStore((s) => s.currentVersion);
  const availableVersion = useUpdaterStore((s) => s.availableVersion);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const releaseDate = useUpdaterStore((s) => s.releaseDate);
  const downloadedBytes = useUpdaterStore((s) => s.downloadedBytes);
  const totalBytes = useUpdaterStore((s) => s.totalBytes);
  const progress = useUpdaterStore((s) => s.progress);
  const errorMessage = useUpdaterStore((s) => s.errorMessage);
  const modalOpen = useUpdaterStore((s) => s.modalOpen);
  const closeModal = useUpdaterStore((s) => s.closeModal);
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall);
  const installAndRelaunch = useUpdaterStore((s) => s.installAndRelaunch);
  const skipAvailableVersion = useUpdaterStore((s) => s.skipAvailableVersion);

  const activeConnectedTabs = useAppStore(
    (s) => s.tabs.filter((tab) => tab.connected && tab.type !== 'asset-list').length,
  );

  useEscapeClose(closeModal);

  if (!modalOpen) return null;

  const formattedDate = formatReleaseDate(releaseDate);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="update-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('update_modal_title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="update-modal-header">
          <div className="update-modal-title-group">
            <span className="update-modal-badge-icon" aria-hidden="true">
              {status === 'ready' || status === 'up-to-date' ? (
                <CheckCircle2 size={16} />
              ) : status === 'error' ? (
                <AlertTriangle size={16} />
              ) : (
                <Sparkles size={16} />
              )}
            </span>
            <div>
              <h2>{t('update_modal_title')}</h2>
              <p className="update-modal-subtitle">
                {t('update_current_version', { version: currentVersion })}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={closeModal}
            aria-label={t('common.dismiss')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="update-modal-body">
          {status === 'checking' && (
            <div className="update-state-block">
              <RefreshCw size={22} className="update-spin" />
              <div className="update-state-title">{t('update_checking')}</div>
            </div>
          )}

          {status === 'up-to-date' && (
            <div className="update-state-block update-state-block--ok">
              <CheckCircle2 size={24} />
              <div className="update-state-title">{t('update_up_to_date')}</div>
              <div className="update-state-desc">
                {t('update_up_to_date_desc', { version: currentVersion })}
              </div>
            </div>
          )}

          {(status === 'available' || status === 'downloading' || status === 'ready') &&
            availableVersion && (
              <>
                <div className="update-version-compare">
                  <span className="update-ver-pill">v{currentVersion}</span>
                  <ArrowRight size={13} className="update-ver-arrow" />
                  <span className="update-ver-pill update-ver-pill--new">v{availableVersion}</span>
                  {formattedDate && <span className="update-ver-date">{formattedDate}</span>}
                </div>

                {releaseNotes && (
                  <div className="update-notes-card">
                    <div className="update-notes-label">{t('update_release_notes')}</div>
                    <pre className="update-notes-content">{releaseNotes}</pre>
                  </div>
                )}

                {status === 'downloading' && (
                  <div className="update-progress-box">
                    <div className="update-progress-head">
                      <span>{t('update_downloading')}</span>
                      <span className="update-progress-stat">
                        {progress !== null ? `${progress}%` : formatUpdateBytes(downloadedBytes)}
                        {totalBytes > 0
                          ? ` · ${formatUpdateBytes(downloadedBytes)} / ${formatUpdateBytes(totalBytes)}`
                          : ''}
                      </span>
                    </div>
                    <div className="update-progress-track">
                      <div
                        className={`update-progress-fill${progress === null ? ' is-indeterminate' : ''}`}
                        style={progress !== null ? { width: `${progress}%` } : undefined}
                      />
                    </div>
                    <div className="update-progress-hint">{t('update_background_hint')}</div>
                  </div>
                )}

                {status === 'ready' && (
                  <div className="update-ready-banner">
                    <CheckCircle2 size={16} />
                    <div>
                      <div className="update-ready-title">{t('update_restart')}</div>
                      {activeConnectedTabs > 0 && (
                        <div className="update-ready-warn">
                          {t('update_restart_active_sessions', { count: activeConnectedTabs })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

          {status === 'error' && (
            <div className="update-error-box">
              <div className="update-error-title">{t('update_error')}</div>
              {errorMessage && <div className="update-error-detail">{errorMessage}</div>}
            </div>
          )}
        </div>

        <div className="update-modal-footer">
          {status === 'available' && (
            <>
              <button type="button" className="ssh-footer-link" onClick={skipAvailableVersion}>
                {t('update_skip_version')}
              </button>
              <div className="ssh-footer-actions">
                <button type="button" className="ssh-footer-link" onClick={closeModal}>
                  {t('update_later')}
                </button>
                <button
                  type="button"
                  className="ssh-footer-link ssh-footer-primary update-action-btn"
                  onClick={() => void downloadAndInstall()}
                >
                  <Download size={13} />
                  <span>{t('update_download')}</span>
                </button>
              </div>
            </>
          )}

          {status === 'downloading' && (
            <>
              <span />
              <button type="button" className="ssh-footer-link" onClick={closeModal}>
                {t('update_hide_to_background')}
              </button>
            </>
          )}

          {status === 'ready' && (
            <>
              <button type="button" className="ssh-footer-link" onClick={closeModal}>
                {t('update_later')}
              </button>
              <button
                type="button"
                className="ssh-footer-link ssh-footer-primary update-action-btn"
                onClick={() => void installAndRelaunch()}
              >
                <RotateCcw size={13} />
                <span>{t('update_restart_now')}</span>
              </button>
            </>
          )}

          {(status === 'up-to-date' || status === 'idle' || status === 'checking') && (
            <>
              <button
                type="button"
                className="ssh-footer-link update-action-btn"
                disabled={status === 'checking'}
                onClick={() => void checkForUpdate({ manual: true })}
              >
                <RefreshCw
                  size={12}
                  className={status === 'checking' ? 'update-spin' : undefined}
                />
                <span>{t('update_recheck')}</span>
              </button>
              <button type="button" className="ssh-footer-link" onClick={closeModal}>
                {t('common.dismiss')}
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <button type="button" className="ssh-footer-link" onClick={closeModal}>
                {t('common.dismiss')}
              </button>
              <button
                type="button"
                className="ssh-footer-link ssh-footer-primary update-action-btn"
                onClick={() =>
                  void (availableVersion ? downloadAndInstall() : checkForUpdate({ manual: true }))
                }
              >
                <RefreshCw size={12} />
                <span>{t('update_retry')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
