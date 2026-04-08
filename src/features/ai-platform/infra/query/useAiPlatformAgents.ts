import { useQuery } from '@tanstack/react-query';

import { getAiPlatformAgentsSnapshot } from '../commands/agents';

export function useAiPlatformAgents() {
  return useQuery({
    queryKey: ['ai-platform', 'agents'],
    queryFn: getAiPlatformAgentsSnapshot,
  });
}