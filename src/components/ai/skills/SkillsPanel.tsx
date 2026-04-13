import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  BookOpen,
  FolderPlus,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ConfirmDialog";

interface SkillRootRecord {
  id: string;
  path: string;
  label: string;
}

interface SkillRecord {
  id: string;
  rootId: string;
  name: string;
  description: string;
  path: string;
  skillFile: string;
  enabled: boolean;
}

interface SkillsSnapshotDto {
  roots: SkillRootRecord[];
  skills: SkillRecord[];
  source: string;
}

export const SkillsPanel: React.FC = () => {
  const { t } = useTranslation("ai");
  const [snapshot, setSnapshot] = useState<SkillsSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const snap =
        await invoke<SkillsSnapshotDto>("ai_platform_get_skills_snapshot");
      setSnapshot(snap);
    } catch (err) {
      console.error("[SkillsPanel] load failed", err);
      toast.error(
        t("skills.loadFailed", { defaultValue: "加载 Skills 失败" }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddRoot = async () => {
    try {
      const selected = await dialogOpen({
        directory: true,
        multiple: false,
        title: t("skills.selectRootDir", {
          defaultValue: "选择 Skills 根目录",
        }),
      });
      if (!selected || Array.isArray(selected)) return;

      const snap = await invoke<SkillsSnapshotDto>(
        "ai_platform_add_skill_root",
        { path: selected },
      );
      setSnapshot(snap);
      toast.success(
        t("skills.rootAdded", { defaultValue: "已添加根目录" }),
        { closeButton: true },
      );
    } catch (err: any) {
      toast.error(String(err));
    }
  };

  const handleRemoveRoot = (root: SkillRootRecord) => {
    setConfirmDialog({
      title: t("skills.removeRoot", { defaultValue: "移除根目录" }),
      message: t("skills.removeRootConfirm", {
        path: root.path,
        defaultValue: `确定移除根目录 "${root.path}"？`,
      }),
      onConfirm: async () => {
        try {
          const snap = await invoke<SkillsSnapshotDto>(
            "ai_platform_remove_skill_root",
            { rootId: root.id },
          );
          setSnapshot(snap);
          setConfirmDialog(null);
        } catch (err) {
          toast.error(String(err));
        }
      },
    });
  };

  const handleToggleSkill = async (skill: SkillRecord) => {
    try {
      const snap = await invoke<SkillsSnapshotDto>(
        "ai_platform_set_skill_enabled",
        { skillId: skill.id, enabled: !skill.enabled },
      );
      setSnapshot(snap);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const roots = snapshot?.roots ?? [];
  const skills = snapshot?.skills ?? [];
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="h-7 px-3">
            {t("skills.skillCount", {
              count: skills.length,
              defaultValue: `${skills.length} 个 Skill`,
            })}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t("skills.enabledCount", {
              count: enabledCount,
              defaultValue: `${enabledCount} 已启用`,
            })}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleAddRoot}
          className="h-8 gap-1.5"
        >
          <FolderPlus size={14} />
          {t("skills.addRoot", { defaultValue: "添加根目录" })}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : roots.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
              <BookOpen size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">
              {t("skills.noRoots", { defaultValue: "暂无 Skills 根目录" })}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t("skills.noRootsHint", {
                defaultValue: "添加一个本地目录以加载其中的 Skill 文件",
              })}
            </p>
            <Button type="button" onClick={handleAddRoot} className="gap-1.5">
              <FolderPlus size={14} />
              {t("skills.addRoot", { defaultValue: "添加根目录" })}
            </Button>
          </div>
        ) : (
          roots.map((root) => {
            const rootSkills = skills.filter((s) => s.rootId === root.id);
            return (
              <RootSection
                key={root.id}
                root={root}
                skills={rootSkills}
                onRemove={() => handleRemoveRoot(root)}
                onToggle={handleToggleSkill}
              />
            );
          })
        )}
      </div>

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

interface RootSectionProps {
  root: SkillRootRecord;
  skills: SkillRecord[];
  onRemove: () => void;
  onToggle: (skill: SkillRecord) => void;
}

const RootSection: React.FC<RootSectionProps> = ({
  root,
  skills,
  onRemove,
  onToggle,
}) => {
  const { t } = useTranslation("ai");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{root.label || root.path}</p>
          <p className="text-xs text-muted-foreground truncate font-mono">
            {root.path}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
          onClick={onRemove}
          title={t("skills.removeRoot", { defaultValue: "移除根目录" })}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground px-2 py-4 text-center border border-dashed border-border rounded-lg">
          {t("skills.noSkillsInRoot", { defaultValue: "该目录中没有 .md Skill 文件" })}
        </p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          {skills.map((skill, idx) => (
            <div
              key={skill.id}
              className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors ${idx < skills.length - 1 ? "border-b border-border" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">
                  {skill.name || skill.skillFile}
                </span>
                {skill.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {skill.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggle(skill)}
                className="flex-shrink-0 transition-opacity"
                title={
                  skill.enabled
                    ? t("common.disable", { defaultValue: "停用" })
                    : t("common.enable", { defaultValue: "启用" })
                }
              >
                {skill.enabled ? (
                  <ToggleRight size={22} className="text-primary" />
                ) : (
                  <ToggleLeft size={22} className="text-muted-foreground" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
