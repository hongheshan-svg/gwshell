import React from 'react';
import { useTranslation } from 'react-i18next';
import type { NicInfo } from '../../types/serverMetrics';

interface Props {
  nics: NicInfo[] | null;
}

export const NicList: React.FC<Props> = ({ nics }) => {
  const { t } = useTranslation();
  return (
    <div className="sp-card sp-card--nics">
      <div className="sp-card__title">{t('serverPanel_nic_title')}</div>
      {(!nics || nics.length === 0) ? (
        <div className="sp-empty">—</div>
      ) : (
        <table className="sp-table">
          <thead>
            <tr>
              <th>{t('serverPanel_nic_name')}</th>
              <th>{t('serverPanel_nic_ipv4')}</th>
              <th>{t('serverPanel_nic_mac')}</th>
            </tr>
          </thead>
          <tbody>
            {nics.map((n) => (
              <tr key={n.name}>
                <td>{n.name}</td>
                <td>{n.ipv4 ?? '—'}</td>
                <td>{n.mac ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
