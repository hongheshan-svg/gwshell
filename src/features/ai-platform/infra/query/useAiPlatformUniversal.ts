import { useQueries } from '@tanstack/react-query';

import { getAiPlatformAgentsSnapshot } from '../commands/agents';
import { getAiPlatformAuthSnapshot } from '../commands/auth';
import { getAiPlatformOpenClawSnapshot } from '../commands/openclaw';
import { getAiPlatformProviders } from '../commands/providers';
import { getAiPlatformProxySnapshot } from '../commands/proxy';
import { getAiPlatformSettingsSnapshot } from '../commands/settings';

export function useAiPlatformUniversal() {
  const results = useQueries({
    queries: [
      { queryKey: ['ai-platform', 'providers'], queryFn: getAiPlatformProviders },
      { queryKey: ['ai-platform', 'auth'], queryFn: getAiPlatformAuthSnapshot },
      { queryKey: ['ai-platform', 'proxy'], queryFn: getAiPlatformProxySnapshot },
      { queryKey: ['ai-platform', 'agents'], queryFn: getAiPlatformAgentsSnapshot },
      { queryKey: ['ai-platform', 'settings'], queryFn: getAiPlatformSettingsSnapshot },
      { queryKey: ['ai-platform', 'openclaw'], queryFn: getAiPlatformOpenClawSnapshot },
    ],
  });

  return {
    providers: results[0].data,
    auth: results[1].data,
    proxy: results[2].data,
    agents: results[3].data,
    settings: results[4].data,
    openclaw: results[5].data,
    isLoading: results.some((result) => result.isLoading),
    error: results.find((result) => result.error)?.error ?? null,
  };
}