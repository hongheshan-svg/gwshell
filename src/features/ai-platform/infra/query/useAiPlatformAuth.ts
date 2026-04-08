import { useQuery } from '@tanstack/react-query';

import { getAiPlatformAuthSnapshot } from '../commands/auth';

export function useAiPlatformAuth() {
  return useQuery({
    queryKey: ['ai-platform', 'auth'],
    queryFn: getAiPlatformAuthSnapshot,
  });
}