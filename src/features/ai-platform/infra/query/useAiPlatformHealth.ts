import { useQuery } from '@tanstack/react-query';
import { getAiPlatformHealth } from '../commands/health';

export function useAiPlatformHealth() {
  return useQuery({
    queryKey: ['ai-platform', 'health'],
    queryFn: getAiPlatformHealth,
  });
}