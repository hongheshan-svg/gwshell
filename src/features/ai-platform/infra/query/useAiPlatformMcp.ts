import { useQuery } from '@tanstack/react-query';

import { getAiPlatformMcpSnapshot } from '../commands/mcp';

export function useAiPlatformMcp() {
  return useQuery({
    queryKey: ['ai-platform', 'mcp'],
    queryFn: getAiPlatformMcpSnapshot,
  });
}