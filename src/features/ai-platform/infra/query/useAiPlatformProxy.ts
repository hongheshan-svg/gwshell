import { useQuery } from '@tanstack/react-query';

import { getAiPlatformProxySnapshot } from '../commands/proxy';

export function useAiPlatformProxy() {
  return useQuery({
    queryKey: ['ai-platform', 'proxy'],
    queryFn: getAiPlatformProxySnapshot,
  });
}