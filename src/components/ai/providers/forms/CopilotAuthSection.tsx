import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { GitBranch, User } from "lucide-react";

interface CopilotAuthSectionProps {
  className?: string;
  selectedAccountId?: string | null;
  onAccountSelect?: (accountId: string | null) => void;
}

/**
 * CopilotAuthSection - GitHub Copilot OAuth section (GWShell stub).
 *
 * NOTE: Full Copilot OAuth flow requires a VSCode extension context.
 * In GWShell, this component shows a placeholder message.
 * Copilot auth is not currently supported in GWShell.
 */
export const CopilotAuthSection: React.FC<CopilotAuthSectionProps> = ({
  className,
}) => {
  const { t } = useTranslation('ai');

  return (
    <div className={`space-y-4 ${className || ""}`}>
      <div className="flex items-center justify-between">
        <Label>{t("copilot.authStatus", "GitHub Copilot 认证")}</Label>
      </div>

      <div className="rounded-lg border border-dashed border-border-default bg-muted/30 p-4 text-center space-y-3">
        <div className="flex justify-center">
          <GitBranch className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "copilot.notSupportedInGwshell",
            "GitHub Copilot 认证在 GWShell 中暂不支持。请使用 API Key 或其他认证方式。",
          )}
        </p>
        <Button type="button" variant="outline" disabled className="gap-2">
          <User className="h-4 w-4" />
          {t("copilot.loginWithGitHub", "使用 GitHub 登录")}
        </Button>
      </div>
    </div>
  );
};

export default CopilotAuthSection;
