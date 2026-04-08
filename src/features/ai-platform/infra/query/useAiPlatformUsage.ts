import { useQuery } from '@tanstack/react-query';

import { getAiPlatformUsageSummary } from '../commands/usage';

export function useAiPlatformUsage(days: number) {
  return useQuery({
    queryKey: ['ai-platform', 'usage', days],
    queryFn: () => getAiPlatformUsageSummary(days),
  });
}