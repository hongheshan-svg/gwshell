import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Save, Plus, AlertCircle } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { FullScreenPanel } from "../common/FullScreenPanel";
import type { McpServerRecord, McpSnapshotDto } from "./types";

interface McpFormModalProps {
  editingServer?: McpServerRecord;
  existingIds: string[];
  onSave: (snapshot: McpSnapshotDto) => void;
  onClose: () => void;
}

const EMPTY_APPS = { claude: true, codex: true, gemini: true, opencode: true };

export const McpFormModal: React.FC<McpFormModalProps> = ({
  editingServer,
  existingIds,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation("ai");
  const isEditing = !!editingServer;

  const [id, setId] = useState(editingServer?.id ?? "");
  const [name, setName] = useState(editingServer?.name ?? "");
  const [command, setCommand] = useState(editingServer?.command ?? "");
  const [argsText, setArgsText] = useState(
    editingServer?.args?.join(" ") ?? "",
  );
  const [envText, setEnvText] = useState(() => {
    if (!editingServer?.env || Object.keys(editingServer.env).length === 0)
      return "";
    return Object.entries(editingServer.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  });
  const [apps, setApps] = useState(editingServer?.syncApps ?? EMPTY_APPS);

  const [idError, setIdError] = useState("");
  const [envError, setEnvError] = useState("");
  const [saving, setSaving] = useState(false);


  const handleIdChange = (v: string) => {
    setId(v);
    if (!isEditing) {
      setIdError(existingIds.includes(v.trim()) ? t("mcp.error.idExists", { defaultValue: "ID 已存在" }) : "");
    }
  };

  const parseEnv = (text: string): Record<string, string> | null => {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) return null;
      result[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    return result;
  };

  const handleSubmit = async () => {
    const trimmedId = id.trim();
    if (!trimmedId) {
      toast.error(t("mcp.error.idRequired", { defaultValue: "请输入服务器 ID" }));
      return;
    }
    if (!isEditing && existingIds.includes(trimmedId)) {
      setIdError(t("mcp.error.idExists", { defaultValue: "ID 已存在" }));
      return;
    }
    if (!command.trim()) {
      toast.error(t("mcp.error.commandRequired", { defaultValue: "请输入命令" }));
      return;
    }

    const env = parseEnv(envText);
    if (env === null) {
      setEnvError(t("mcp.error.envInvalid", { defaultValue: "环境变量格式错误（每行 KEY=VALUE）" }));
      return;
    }
    setEnvError("");

    const args = argsText.trim()
      ? argsText.trim().split(/\s+/)
      : [];

    const record: McpServerRecord = {
      id: trimmedId,
      name: name.trim() || trimmedId,
      command: command.trim(),
      args,
      env,
      syncApps: apps,
      enabled: editingServer?.enabled ?? true,
    };

    setSaving(true);
    try {
      const snapshot = await invoke<McpSnapshotDto>("ai_platform_save_mcp_server", {
        server: record,
      });
      toast.success(t("common.success", { defaultValue: "保存成功" }), { closeButton: true });
      onSave(snapshot);
    } catch (err: any) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FullScreenPanel
      isOpen={true}
      title={
        isEditing
          ? t("mcp.editServer", { defaultValue: "编辑 MCP 服务器" })
          : t("mcp.addServer", { defaultValue: "添加 MCP 服务器" })
      }
      onClose={onClose}
      footer={
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={saving || (!isEditing && !!idError)}
        >
          {isEditing ? <Save size={16} /> : <Plus size={16} />}
          {saving
            ? t("common.saving", { defaultValue: "保存中…" })
            : isEditing
              ? t("common.save", { defaultValue: "保存" })
              : t("common.add", { defaultValue: "添加" })}
        </Button>
      }
    >
      <div className="space-y-6 max-w-2xl">
        {/* ID */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("mcp.form.title", { defaultValue: "服务器 ID" })}{" "}
            <span className="text-destructive">*</span>
          </label>
          {idError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle size={12} />
              {idError}
            </p>
          )}
          <Input
            value={id}
            onChange={(e) => handleIdChange(e.target.value)}
            placeholder={t("mcp.form.titlePlaceholder", { defaultValue: "e.g. filesystem" })}
            disabled={isEditing}
          />
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("mcp.form.name", { defaultValue: "显示名称" })}
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("mcp.form.namePlaceholder", { defaultValue: "可选，默认使用 ID" })}
          />
        </div>

        {/* Command */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("mcp.form.command", { defaultValue: "命令" })}{" "}
            <span className="text-destructive">*</span>
          </label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx, uvx, node, python, ..."
            className="font-mono text-sm"
          />
        </div>

        {/* Args */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("mcp.form.args", { defaultValue: "参数（空格分隔）" })}
          </label>
          <Input
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
            className="font-mono text-sm"
          />
        </div>

        {/* Env */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("mcp.form.env", { defaultValue: "环境变量（每行 KEY=VALUE）" })}
          </label>
          {envError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle size={12} />
              {envError}
            </p>
          )}
          <textarea
            value={envText}
            onChange={(e) => { setEnvText(e.target.value); setEnvError(""); }}
            placeholder={"API_KEY=your-key\nANOTHER_VAR=value"}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          />
        </div>

        {/* Sync Apps */}
        <div className="space-y-2">
          <label className="text-sm font-medium">
            {t("mcp.form.enabledApps", { defaultValue: "同步到应用" })}
          </label>
          <div className="flex flex-wrap gap-4">
            {(["claude", "codex", "gemini", "opencode"] as const).map((app) => (
              <div key={app} className="flex items-center gap-2">
                <Checkbox
                  id={`sync-${app}`}
                  checked={apps[app]}
                  onCheckedChange={(checked: boolean) =>
                    setApps({ ...apps, [app]: checked })
                  }
                />
                <label
                  htmlFor={`sync-${app}`}
                  className="text-sm cursor-pointer select-none capitalize"
                >
                  {app === "opencode" ? "OpenCode" : app.charAt(0).toUpperCase() + app.slice(1)}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </FullScreenPanel>
  );
};
