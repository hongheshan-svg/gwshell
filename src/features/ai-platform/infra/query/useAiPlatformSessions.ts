import { useQuery } from '@tanstack/react-query';

import { getAiPlatformSessionsSnapshot } from '../commands/sessions';

export function useAiPlatformSessions() {
  return useQuery({
    queryKey: ['ai-platform', 'sessions'],
    queryFn: getAiPlatformSessionsSnapshot,
  });
}