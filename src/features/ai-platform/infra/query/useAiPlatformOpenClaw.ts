import { useQuery } from '@tanstack/react-query';

import { getAiPlatformOpenClawSnapshot } from '../commands/openclaw';

export function useAiPlatformOpenClaw() {
  return useQuery({
    queryKey: ['ai-platform', 'openclaw'],
    queryFn: getAiPlatformOpenClawSnapshot,
  });
}