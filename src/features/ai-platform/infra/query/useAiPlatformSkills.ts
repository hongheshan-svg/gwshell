import { useQuery } from '@tanstack/react-query';

import { getAiPlatformSkillsSnapshot } from '../commands/skills';

export function useAiPlatformSkills() {
  return useQuery({
    queryKey: ['ai-platform', 'skills'],
    queryFn: getAiPlatformSkillsSnapshot,
  });
}