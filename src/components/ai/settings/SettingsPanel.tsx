import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  FolderSearch,
  Undo2,
  Save,
  Loader2,
  Upload,
  Languages,
  Palette,
  FolderOpen,
  Database,
  Cloud,
  Globe,
  Info,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Badge } from "../ui/badge";
import { useAppStore } from "../../../stores/appStore";
import type {
  AiPlatformSettingsRecord,
  SettingsSnapshotDto,
} from "./types";

// ─── helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AiPlatformSettingsRecord = {
  directories: {
    defaultWorkspaceRoot: "",
    claudeConfigDir: "",
    codexConfigDir: "",
    geminiConfigDir: "",
    opencodeConfigDir: "",
    openclawConfigDir: "",
  },
  appearance: { theme: "dark", language: "zh" },
  backup: { enabled: true, intervalHours: 24, retentionCount: 14 },
  webdav: {
    enabled: false,
    baseUrl: "",
    username: "",
    password: "",
    remotePath: "/gwshell/ai-platform",
    autoSync: false,
  },
  outboundProxy: { url: "" },
};

// ─── main component ───────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
  const { t } = useTranslation("ai");
  const setTheme = useAppStore((s) => s.setTheme);
  const setLocale = useAppStore((s) => s.setLocale);

  const [snapshot, setSnapshot] = useState<SettingsSnapshotDto | null>(null);
  const [draft, setDraft] = useState<AiPlatformSettingsRecord>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const snap = await invoke<SettingsSnapshotDto>(
        "ai_platform_get_settings_snapshot",
      );
      setSnapshot(snap);
      setDraft(snap.settings);
    } catch (err) {
      console.error("[SettingsPanel] load failed", err);
      toast.error(t("settings.loadFailed", { defaultValue: "加载设置失败" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const snap = await invoke<SettingsSnapshotDto>(
        "ai_platform_save_settings",
        { settings: draft },
      );
      setSnapshot(snap);
      setDraft(snap.settings);

      // sync appearance to gwshell app store
      const th = draft.appearance.theme;
      if (th === "dark" || th === "light") setTheme(th);
      const lang = draft.appearance.language;
      if (["zh", "en"].includes(lang)) {
        setLocale(lang as "zh" | "en");
      }

      toast.success(
        t("settings.saved", { defaultValue: "设置已保存" }),
        { closeButton: true },
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const providers = await invoke<unknown[]>("import_from_cc_switch");
      toast.success(
        t("settings.importSuccess", {
          count: providers.length,
          defaultValue: `已从 ~/.cc-switch/config.json 导入 ${providers.length} 个供应商`,
        }),
        { closeButton: true },
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setImporting(false);
    }
  };

  const browseDir = async (
    field: keyof AiPlatformSettingsRecord["directories"],
  ) => {
    try {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
        title: t("settings.browseDirectory", { defaultValue: "选择目录" }),
      });
      if (!selected || Array.isArray(selected)) return;
      setDraft((d) => ({
        ...d,
        directories: { ...d.directories, [field]: selected },
      }));
    } catch {}
  };

  const resetDir = (field: keyof AiPlatformSettingsRecord["directories"]) => {
    setDraft((d) => ({
      ...d,
      directories: { ...d.directories, [field]: "" },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sticky save bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background">
        <p className="text-sm text-muted-foreground">
          {t("settings.panelHint", {
            defaultValue: "修改后点击保存生效",
          })}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="h-8 gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t("common.save", { defaultValue: "保存" })}
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Accordion
          type="multiple"
          defaultValue={["appearance", "directories"]}
          className="space-y-2"
        >
          {/* ── Appearance ── */}
          <AccordionItem
            value="appearance"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Palette className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-semibold">
                  {t("settings.appearance", { defaultValue: "外观" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-5">
              {/* Language */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-sm font-medium">
                    {t("settings.language", { defaultValue: "语言" })}
                  </h3>
                </div>
                <div className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
                  {(["zh", "en"] as const).map((lang) => (
                    <Button
                      key={lang}
                      type="button"
                      size="sm"
                      variant={
                        draft.appearance.language === lang ? "default" : "ghost"
                      }
                      className="min-w-[80px]"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          appearance: { ...d.appearance, language: lang },
                        }))
                      }
                    >
                      {lang === "zh" ? "中文" : "English"}
                    </Button>
                  ))}
                </div>
              </section>

              {/* Theme */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-sm font-medium">
                    {t("settings.theme", { defaultValue: "主题" })}
                  </h3>
                </div>
                <div className="inline-flex gap-1 rounded-md border border-border bg-background p-1">
                  {(["dark", "light"] as const).map((th) => (
                    <Button
                      key={th}
                      type="button"
                      size="sm"
                      variant={
                        draft.appearance.theme === th ? "default" : "ghost"
                      }
                      className="min-w-[80px]"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          appearance: { ...d.appearance, theme: th },
                        }))
                      }
                    >
                      {th === "dark"
                        ? t("settings.themeDark", { defaultValue: "暗色" })
                        : t("settings.themeLight", { defaultValue: "亮色" })}
                    </Button>
                  ))}
                </div>
              </section>
            </AccordionContent>
          </AccordionItem>

          {/* ── Directories ── */}
          <AccordionItem
            value="directories"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <FolderOpen className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold">
                  {t("settings.directories", { defaultValue: "目录配置" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-4">
              <p className="text-xs text-muted-foreground">
                {t("settings.directoriesHint", {
                  defaultValue:
                    "留空使用默认目录（~/.claude、~/.codex 等）",
                })}
              </p>

              {(
                [
                  [
                    "claudeConfigDir",
                    t("settings.claudeConfigDir", {
                      defaultValue: "Claude 配置目录",
                    }),
                    "~/.claude",
                  ],
                  [
                    "codexConfigDir",
                    t("settings.codexConfigDir", {
                      defaultValue: "Codex 配置目录",
                    }),
                    "~/.codex",
                  ],
                  [
                    "geminiConfigDir",
                    t("settings.geminiConfigDir", {
                      defaultValue: "Gemini 配置目录",
                    }),
                    "~/.gemini",
                  ],
                  [
                    "opencodeConfigDir",
                    t("settings.opencodeConfigDir", {
                      defaultValue: "OpenCode 配置目录",
                    }),
                    "~/.opencode",
                  ],
                  [
                    "openclawConfigDir",
                    t("settings.openclawConfigDir", {
                      defaultValue: "OpenClaw 配置目录",
                    }),
                    "~/.openclaw",
                  ],
                  [
                    "defaultWorkspaceRoot",
                    t("settings.defaultWorkspaceRoot", {
                      defaultValue: "默认工作区根目录",
                    }),
                    "~",
                  ],
                ] as [
                  keyof AiPlatformSettingsRecord["directories"],
                  string,
                  string,
                ][]
              ).map(([field, label, placeholder]) => (
                <DirField
                  key={field}
                  label={label}
                  value={draft.directories[field]}
                  placeholder={placeholder}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      directories: { ...d.directories, [field]: v },
                    }))
                  }
                  onBrowse={() => browseDir(field)}
                  onReset={() => resetDir(field)}
                />
              ))}
            </AccordionContent>
          </AccordionItem>

          {/* ── Backup ── */}
          <AccordionItem
            value="backup"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold">
                  {t("settings.backup", { defaultValue: "自动备份" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {t("settings.backupEnabled", { defaultValue: "启用自动备份" })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.backupHint", {
                      defaultValue: "定期备份 AI 平台配置数据",
                    })}
                  </p>
                </div>
                <Switch
                  checked={draft.backup.enabled}
                  onCheckedChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      backup: { ...d.backup, enabled: v },
                    }))
                  }
                />
              </div>

              {draft.backup.enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      {t("settings.backupInterval", {
                        defaultValue: "备份间隔（小时）",
                      })}
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={draft.backup.intervalHours}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          backup: {
                            ...d.backup,
                            intervalHours: Number(e.target.value) || 24,
                          },
                        }))
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      {t("settings.backupRetention", {
                        defaultValue: "保留备份数量",
                      })}
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={draft.backup.retentionCount}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          backup: {
                            ...d.backup,
                            retentionCount: Number(e.target.value) || 14,
                          },
                        }))
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ── WebDAV ── */}
          <AccordionItem
            value="webdav"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Cloud className="h-4 w-4 text-sky-500" />
                <span className="text-sm font-semibold">
                  {t("settings.webdav", { defaultValue: "WebDAV 同步" })}
                </span>
                {draft.webdav.enabled && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1.5 ml-auto mr-4 bg-sky-500/10 text-sky-600"
                  >
                    {t("settings.webdavEnabled", { defaultValue: "已启用" })}
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {t("settings.webdavEnable", {
                    defaultValue: "启用 WebDAV 同步",
                  })}
                </p>
                <Switch
                  checked={draft.webdav.enabled}
                  onCheckedChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      webdav: { ...d.webdav, enabled: v },
                    }))
                  }
                />
              </div>

              {draft.webdav.enabled && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      {t("settings.webdavUrl", { defaultValue: "WebDAV 地址" })}
                    </label>
                    <Input
                      value={draft.webdav.baseUrl}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          webdav: { ...d.webdav, baseUrl: e.target.value },
                        }))
                      }
                      placeholder="https://dav.example.com"
                      className="text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">
                        {t("settings.webdavUsername", {
                          defaultValue: "用户名",
                        })}
                      </label>
                      <Input
                        value={draft.webdav.username}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            webdav: { ...d.webdav, username: e.target.value },
                          }))
                        }
                        autoComplete="off"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">
                        {t("settings.webdavPassword", {
                          defaultValue: "密码",
                        })}
                      </label>
                      <Input
                        value={draft.webdav.password}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            webdav: { ...d.webdav, password: e.target.value },
                          }))
                        }
                        type="password"
                        autoComplete="new-password"
                        className="text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">
                      {t("settings.webdavRemotePath", {
                        defaultValue: "远端路径",
                      })}
                    </label>
                    <Input
                      value={draft.webdav.remotePath}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          webdav: { ...d.webdav, remotePath: e.target.value },
                        }))
                      }
                      placeholder="/gwshell/ai-platform"
                      className="text-sm font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {t("settings.webdavAutoSync", {
                          defaultValue: "自动同步",
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.webdavAutoSyncHint", {
                          defaultValue: "启动时自动从 WebDAV 拉取配置",
                        })}
                      </p>
                    </div>
                    <Switch
                      checked={draft.webdav.autoSync}
                      onCheckedChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          webdav: { ...d.webdav, autoSync: v },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* ── Outbound Proxy ── */}
          <AccordionItem
            value="proxy"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-semibold">
                  {t("settings.outboundProxy", { defaultValue: "出站代理" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("settings.outboundProxyHint", {
                  defaultValue:
                    "设置 AI 请求使用的 HTTP/HTTPS 出站代理（留空不使用）",
                })}
              </p>
              <Input
                value={draft.outboundProxy.url}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    outboundProxy: { url: e.target.value },
                  }))
                }
                placeholder="http://127.0.0.1:7890"
                className="text-sm font-mono"
              />
            </AccordionContent>
          </AccordionItem>

          {/* ── Import / Export ── */}
          <AccordionItem
            value="import"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Upload className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-semibold">
                  {t("settings.importExport", { defaultValue: "导入 / 导出" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("settings.importHint", {
                  defaultValue:
                    "从 CC Switch JSON 配置文件导入供应商列表",
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleImport}
                disabled={importing}
                className="gap-2"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {t("settings.importFile", { defaultValue: "选择文件并导入" })}
              </Button>
            </AccordionContent>
          </AccordionItem>

          {/* ── About ── */}
          <AccordionItem
            value="about"
            className="rounded-xl border border-border overflow-hidden"
          >
            <AccordionTrigger className="px-5 py-3.5 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
              <div className="flex items-center gap-3">
                <Info className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  {t("settings.about", { defaultValue: "关于" })}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 pt-3 border-t border-border">
              <AboutInfo snapshot={snapshot} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};

// ─── sub-components ───────────────────────────────────────────────────────────

interface DirFieldProps {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
  onReset: () => void;
}

const DirField: React.FC<DirFieldProps> = ({
  label,
  value,
  placeholder,
  onChange,
  onBrowse,
  onReset,
}) => {
  const { t } = useTranslation("ai");
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-xs font-mono flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={onBrowse}
          title={t("settings.browseDirectory", { defaultValue: "浏览" })}
        >
          <FolderSearch className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={onReset}
          title={t("settings.resetDefault", { defaultValue: "重置" })}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

interface AboutInfoProps {
  snapshot: SettingsSnapshotDto | null;
}

const AboutInfo: React.FC<AboutInfoProps> = ({ snapshot }) => {
  const { t } = useTranslation("ai");
  const [appVersion, setAppVersion] = useState<string>("—");

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const statuses = snapshot?.statuses ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">GWShell</p>
        <p className="text-xs text-muted-foreground">
          v{appVersion} — AI Platform (cc-switch port)
        </p>
      </div>

      {statuses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("settings.statusChecks", { defaultValue: "系统状态" })}
          </p>
          <div className="space-y-1">
            {statuses.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    s.level === "ok"
                      ? "bg-green-500"
                      : s.level === "warn"
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                />
                <span className="font-medium">{s.label}</span>
                {s.detail && (
                  <span className="text-muted-foreground truncate">
                    — {s.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
