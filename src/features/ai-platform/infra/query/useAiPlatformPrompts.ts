import { useQuery } from '@tanstack/react-query';

import { getAiPlatformPromptSnapshot } from '../commands/prompts';

export function useAiPlatformPrompts(projectDir: string) {
  return useQuery({
    queryKey: ['ai-platform', 'prompts', projectDir],
    queryFn: () => getAiPlatformPromptSnapshot(projectDir),
    enabled: projectDir.trim().length > 0,
  });
}