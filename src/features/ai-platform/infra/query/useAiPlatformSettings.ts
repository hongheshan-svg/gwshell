import { useQuery } from '@tanstack/react-query';

import { getAiPlatformSettingsSnapshot } from '../commands/settings';

export function useAiPlatformSettings() {
  return useQuery({
    queryKey: ['ai-platform', 'settings'],
    queryFn: getAiPlatformSettingsSnapshot,
  });
}