import {
  BarChart3,
  Check,
  Copy,
  Edit,
  Loader2,
  Minus,
  Play,
  Plus,
  Terminal,
  TestTube2,
  Trash2,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import type { AppId } from "../lib/api";

interface ProviderActionsProps {
  appId?: AppId;
  isCurrent: boolean;
  isInConfig?: boolean;
  isTesting?: boolean;
  isProxyTakeover?: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onTest?: () => void;
  onConfigureUsage?: () => void;
  onDelete: () => void;
  onRemoveFromConfig?: () => void;
  onOpenTerminal?: () => void;
}

export function ProviderActions({
  appId,
  isCurrent,
  isInConfig = false,
  isTesting,
  isProxyTakeover = false,
  onSwitch,
  onEdit,
  onDuplicate,
  onTest,
  onConfigureUsage,
  onDelete,
  onRemoveFromConfig,
  onOpenTerminal,
}: ProviderActionsProps) {
  const iconButtonClass = "h-8 w-8 p-1";

  // Additive-mode apps (OpenCode / OpenClaw): toggle membership in config
  const isAdditiveMode =
    appId === "opencode" || appId === "openclaw";

  const handleMainButtonClick = () => {
    if (isAdditiveMode) {
      // Toggle config state (add / remove)
      if (isInConfig) {
        if (onRemoveFromConfig) {
          onRemoveFromConfig();
        } else {
          onDelete();
        }
      } else {
        onSwitch(); // Add to config
      }
    } else {
      onSwitch();
    }
  };

  const getMainButtonState = () => {
    // Additive mode (OpenCode / OpenClaw)
    if (isAdditiveMode) {
      if (isInConfig) {
        return {
          disabled: false,
          variant: "secondary" as const,
          className:
            "bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-900/70",
          icon: <Minus className="h-4 w-4" />,
          text: "Remove",
        };
      }
      return {
        disabled: false,
        variant: "default" as const,
        className:
          "bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700",
        icon: <Plus className="h-4 w-4" />,
        text: "Add",
      };
    }

    if (isCurrent) {
      return {
        disabled: true,
        variant: "secondary" as const,
        className:
          "bg-gray-200 text-muted-foreground hover:bg-gray-200 hover:text-muted-foreground dark:bg-gray-700 dark:hover:bg-gray-700",
        icon: <Check className="h-4 w-4" />,
        text: "In use",
      };
    }

    return {
      disabled: false,
      variant: "default" as const,
      className: isProxyTakeover
        ? "bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        : "",
      icon: <Play className="h-4 w-4" />,
      text: "Enable",
    };
  };

  const buttonState = getMainButtonState();

  const canDelete = isAdditiveMode ? true : !isCurrent;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant={buttonState.variant}
        onClick={handleMainButtonClick}
        disabled={buttonState.disabled}
        className={cn("w-[4.5rem] px-2.5", buttonState.className)}
      >
        {buttonState.icon}
        {buttonState.text}
      </Button>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onEdit}
          title="Edit"
          className={iconButtonClass}
        >
          <Edit className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onDuplicate}
          title="Duplicate"
          className={iconButtonClass}
        >
          <Copy className="h-4 w-4" />
        </Button>

        {onTest && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onTest}
            disabled={isTesting}
            title="Test provider"
            className={iconButtonClass}
          >
            {isTesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube2 className="h-4 w-4" />
            )}
          </Button>
        )}

        {onConfigureUsage && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onConfigureUsage}
            title="Configure usage"
            className={iconButtonClass}
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
        )}

        {onOpenTerminal && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onOpenTerminal}
            title="Open terminal"
            className={cn(
              iconButtonClass,
              "hover:text-emerald-600 dark:hover:text-emerald-400",
            )}
          >
            <Terminal className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={canDelete ? onDelete : undefined}
          title="Delete"
          className={cn(
            iconButtonClass,
            canDelete && "hover:text-red-500 dark:hover:text-red-400",
            !canDelete && "opacity-40 cursor-not-allowed text-muted-foreground",
          )}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
