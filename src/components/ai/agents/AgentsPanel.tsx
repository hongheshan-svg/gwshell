import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AgentsPanel() {
  const { t } = useTranslation("ai");
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
        <Bot className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold">
        {t("agents.comingSoon", { defaultValue: "即将推出" })}
      </h3>
      <p className="text-muted-foreground max-w-md text-sm">
        {t("agents.comingSoonDesc", {
          defaultValue:
            "Agents 管理功能正在开发中，敬请期待。",
        })}
      </p>
    </div>
  );
}
