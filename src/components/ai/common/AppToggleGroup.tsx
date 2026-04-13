import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { ClaudeIcon, CodexIcon, GeminiIcon } from "../BrandIcons";

export type McpAppId = "claude" | "codex" | "gemini" | "opencode";

const APP_META: Record<
  McpAppId,
  { label: string; icon: React.ReactNode; activeClass: string }
> = {
  claude: {
    label: "Claude",
    icon: <ClaudeIcon size={13} />,
    activeClass:
      "bg-orange-500/10 ring-1 ring-orange-500/20 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400",
  },
  codex: {
    label: "Codex",
    icon: <CodexIcon size={13} />,
    activeClass:
      "bg-green-500/10 ring-1 ring-green-500/20 hover:bg-green-500/20 text-green-600 dark:text-green-400",
  },
  gemini: {
    label: "Gemini",
    icon: <GeminiIcon size={13} />,
    activeClass:
      "bg-blue-500/10 ring-1 ring-blue-500/20 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  opencode: {
    label: "OpenCode",
    icon: (
      <span className="text-[10px] font-bold leading-none">OC</span>
    ),
    activeClass:
      "bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
  },
};

export const MCP_APP_IDS: McpAppId[] = ["claude", "codex", "gemini", "opencode"];

interface AppToggleGroupProps {
  apps: Record<McpAppId, boolean>;
  onToggle: (app: McpAppId, enabled: boolean) => void;
  appIds?: McpAppId[];
}

export const AppToggleGroup: React.FC<AppToggleGroupProps> = ({
  apps,
  onToggle,
  appIds = MCP_APP_IDS,
}) => {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {appIds.map((app) => {
        const { label, icon, activeClass } = APP_META[app];
        const enabled = apps[app];
        return (
          <Tooltip key={app}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggle(app, !enabled)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                  enabled ? activeClass : "opacity-35 hover:opacity-70"
                }`}
              >
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                {label}
                {enabled ? " ✓" : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};
