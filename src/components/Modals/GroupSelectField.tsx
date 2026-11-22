import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';

interface GroupSelectFieldProps {
  value: string;
  onChange: (group: string) => void;
}

export const GroupSelectField: React.FC<GroupSelectFieldProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const sessions = useAppStore((s) => s.sessions);

  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const g = s.group?.trim();
      if (g) set.add(g);
    }
    return Array.from(set).sort();
  }, [sessions]);

  return (
    <div className="ssh-form-group">
      <label>{t('session_group')}</label>
      <input
        type="text"
        list="gwshell-session-group-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('session_group_placeholder')}
      />
      <datalist id="gwshell-session-group-options">
        {existingGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  );
};
