import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Server, Edit3, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  TooltipProvider,
} from "../ui/tooltip";
import { ConfirmDialog } from "../ConfirmDialog";
import { AppToggleGroup, MCP_APP_IDS, type McpAppId } from "../common/AppToggleGroup";
import { ListItemRow } from "../common/ListItemRow";
import { McpFormModal } from "./McpFormModal";
import type { McpServerRecord, McpSnapshotDto } from "./types";

interface McpPanelProps {
  onBack: () => void;
}

export const McpPanel: React.FC<McpPanelProps> = ({ onBack: _onBack }) => {
  const { t } = useTranslation("ai");
  const [snapshot, setSnapshot] = useState<McpSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerRecord | undefined>();
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const snap = await invoke<McpSnapshotDto>("ai_platform_get_mcp_snapshot");
      setSnapshot(snap);
    } catch (err) {
      console.error("[McpPanel] load failed", err);
      toast.error(t("mcp.loadFailed", { defaultValue: "加载 MCP 服务器失败" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleApp = async (
    serverId: string,
    app: McpAppId,
    enabled: boolean,
  ) => {
    if (!snapshot) return;
    const server = snapshot.servers.find((s) => s.id === serverId);
    if (!server) return;
    const updated: McpServerRecord = {
      ...server,
      syncApps: { ...server.syncApps, [app]: enabled },
    };
    try {
      const snap = await invoke<McpSnapshotDto>("ai_platform_save_mcp_server", {
        server: updated,
      });
      setSnapshot(snap);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleEdit = (server: McpServerRecord) => {
    setEditingServer(server);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingServer(undefined);
    setFormOpen(true);
  };

  const handleDelete = (server: McpServerRecord) => {
    setConfirmDialog({
      title: t("mcp.unifiedPanel.deleteServer", { defaultValue: "删除服务器" }),
      message: t("mcp.unifiedPanel.deleteConfirm", {
        id: server.id,
        defaultValue: `确定删除服务器 "${server.id}"？`,
      }),
      onConfirm: async () => {
        try {
          const snap = await invoke<McpSnapshotDto>(
            "ai_platform_delete_mcp_server",
            { serverId: server.id },
          );
          setSnapshot(snap);
          setConfirmDialog(null);
          toast.success(t("common.success", { defaultValue: "已删除" }), { closeButton: true });
        } catch (err) {
          toast.error(String(err));
        }
      },
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await invoke("ai_platform_sync_mcp_servers");
      toast.success(t("mcp.syncSuccess", { defaultValue: "已同步到磁盘配置" }), { closeButton: true });
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSyncing(false);
    }
  };

  const servers = snapshot?.servers ?? [];

  const enabledCounts = MCP_APP_IDS.reduce(
    (acc, app) => {
      acc[app] = servers.filter((s) => s.syncApps[app]).length;
      return acc;
    },
    {} as Record<McpAppId, number>,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="h-7 px-3">
            {t("mcp.serverCount", {
              count: servers.length,
              defaultValue: `${servers.length} 个服务器`,
            })}
          </Badge>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {MCP_APP_IDS.map((app) => (
              <span key={app} className="opacity-75">
                {app === "opencode" ? "OC" : app.slice(0, 1).toUpperCase() + app.slice(1, 3)}:{" "}
                <strong>{enabledCounts[app]}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="h-8 gap-1.5"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("mcp.sync", { defaultValue: "同步" })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            className="h-8"
          >
            {t("mcp.addServer", { defaultValue: "添加服务器" })}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
              <Server size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">
              {t("mcp.unifiedPanel.noServers", { defaultValue: "暂无 MCP 服务器" })}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t("mcp.emptyDescription", { defaultValue: "添加 MCP 服务器以扩展 AI 工具能力" })}
            </p>
            <Button type="button" onClick={handleAdd}>
              {t("mcp.addServer", { defaultValue: "添加服务器" })}
            </Button>
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="rounded-xl border border-border overflow-hidden">
              {servers.map((server, idx) => (
                <McpListItem
                  key={server.id}
                  server={server}
                  onToggleApp={(app, enabled) =>
                    handleToggleApp(server.id, app, enabled)
                  }
                  onEdit={() => handleEdit(server)}
                  onDelete={() => handleDelete(server)}
                  isLast={idx === servers.length - 1}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* Form modal */}
      {formOpen && (
        <McpFormModal
          editingServer={editingServer}
          existingIds={servers
            .filter((s) => s.id !== editingServer?.id)
            .map((s) => s.id)}
          onSave={(snap) => {
            setSnapshot(snap);
            setFormOpen(false);
            setEditingServer(undefined);
          }}
          onClose={() => {
            setFormOpen(false);
            setEditingServer(undefined);
          }}
        />
      )}

      {/* Confirm delete */}
      {confirmDialog && (
        <ConfirmDialog
          isOpen={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
};

interface McpListItemProps {
  server: McpServerRecord;
  onToggleApp: (app: McpAppId, enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  isLast?: boolean;
}

const McpListItem: React.FC<McpListItemProps> = ({
  server,
  onToggleApp,
  onEdit,
  onDelete,
  isLast,
}) => {
  const { t } = useTranslation("ai");
  const cmdPreview = [server.command, ...server.args].join(" ").slice(0, 60);

  return (
    <ListItemRow isLast={isLast}>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm truncate block">
          {server.name || server.id}
        </span>
        {cmdPreview && (
          <p
            className="text-xs text-muted-foreground truncate font-mono"
            title={cmdPreview}
          >
            {cmdPreview}
          </p>
        )}
      </div>

      <AppToggleGroup apps={server.syncApps} onToggle={onToggleApp} />

      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          title={t("common.edit", { defaultValue: "编辑" })}
        >
          <Edit3 size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          title={t("common.delete", { defaultValue: "删除" })}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </ListItemRow>
  );
};
