import { useQuery } from '@tanstack/react-query';

import { getAiPlatformWorkspaceSnapshot } from '../commands/workspace';

export function useAiPlatformWorkspace(workspaceRoot: string) {
  return useQuery({
    queryKey: ['ai-platform', 'workspace', workspaceRoot],
    queryFn: () => getAiPlatformWorkspaceSnapshot(workspaceRoot),
    enabled: workspaceRoot.trim().length > 0,
  });
}