import { Bot } from 'lucide-ai';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

export function SmokeCard() {
  const { t } = useTranslation('ai');
  return (
    <div className="p-6">
      <div className="bg-card text-card-foreground rounded-lg shadow-md p-4 max-w-md border" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="flex items-center gap-3 mb-3">
          <Bot className="w-6 h-6 text-blue-500" />
          <div>
            <h3 className="text-base font-semibold">{t('app.title', 'CC Switch')}</h3>
            <p className="text-xs text-muted-foreground">{t('app.description', '')}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="default" size="sm">{t('common.add', 'Add')}</Button>
          <Button variant="outline" size="sm">{t('common.edit', 'Edit')}</Button>
          <Button variant="destructive" size="sm">{t('common.delete', 'Delete')}</Button>
          <Button variant="ghost" size="sm">{t('common.cancel', 'Cancel')}</Button>
        </div>
      </div>
    </div>
  );
}