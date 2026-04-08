import { useQuery } from '@tanstack/react-query';
import { getAiPlatformProviders } from '../commands/providers';

export function useAiPlatformProviders() {
  return useQuery({
    queryKey: ['ai-platform', 'providers'],
    queryFn: getAiPlatformProviders,
  });
}