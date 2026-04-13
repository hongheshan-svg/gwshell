import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Save, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { ConfirmDialog } from "../ConfirmDialog";
import { fmtUsd } from "./format";
import type { ModelPricing } from "./types";

const EMPTY: ModelPricing = {
  model: "",
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
  currency: "USD",
};

interface EditRowProps {
  initial: ModelPricing;
  onSave: (p: ModelPricing) => void;
  onCancel: () => void;
  existingModels: string[];
  isNew: boolean;
}

const EditRow: React.FC<EditRowProps> = ({
  initial,
  onSave,
  onCancel,
  existingModels,
  isNew,
}) => {
  const { t } = useTranslation("ai");
  const [model, setModel] = useState(initial.model);
  const [inputPrice, setInputPrice] = useState(
    String(initial.inputPricePerMillion),
  );
  const [outputPrice, setOutputPrice] = useState(
    String(initial.outputPricePerMillion),
  );

  const handleSave = () => {
    const trimModel = model.trim();
    if (!trimModel) {
      toast.error(
        t("usage.pricing.modelRequired", { defaultValue: "请输入模型名称" }),
      );
      return;
    }
    if (isNew && existingModels.includes(trimModel)) {
      toast.error(
        t("usage.pricing.modelExists", { defaultValue: "该模型已存在" }),
      );
      return;
    }
    const inp = parseFloat(inputPrice);
    const out = parseFloat(outputPrice);
    if (isNaN(inp) || inp < 0 || isNaN(out) || out < 0) {
      toast.error(
        t("usage.pricing.invalidPrice", { defaultValue: "价格格式不正确" }),
      );
      return;
    }
    onSave({
      model: trimModel,
      inputPricePerMillion: inp,
      outputPricePerMillion: out,
      currency: "USD",
    });
  };

  return (
    <TableRow>
      <TableCell>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="claude-3-5-sonnet-20241022"
          className="h-7 text-xs font-mono"
          disabled={!isNew}
        />
      </TableCell>
      <TableCell>
        <Input
          value={inputPrice}
          onChange={(e) => setInputPrice(e.target.value)}
          type="number"
          min={0}
          step={0.01}
          placeholder="3.00"
          className="h-7 text-xs text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          value={outputPrice}
          onChange={(e) => setOutputPrice(e.target.value)}
          type="number"
          min={0}
          step={0.01}
          placeholder="15.00"
          className="h-7 text-xs text-right"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleSave}
          >
            <Save size={12} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onCancel}
          >
            <X size={12} />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

interface PricingPanelProps {
  initialPricing?: ModelPricing[];
}

export const PricingPanel: React.FC<PricingPanelProps> = ({
  initialPricing,
}) => {
  const { t } = useTranslation("ai");
  const [pricing, setPricing] = useState<ModelPricing[]>(
    initialPricing ?? [],
  );
  const [loading, setLoading] = useState(!initialPricing);
  const [saving, setSaving] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await invoke<ModelPricing[]>(
        "ai_platform_get_model_pricing",
      );
      setPricing(data);
    } catch (err) {
      console.error("[PricingPanel]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialPricing) load();
  }, [initialPricing, load]);

  const saveAll = async (updated: ModelPricing[]) => {
    setSaving(true);
    try {
      await invoke("ai_platform_save_model_pricing", { pricing: updated });
      setPricing(updated);
      toast.success(
        t("usage.pricing.saved", { defaultValue: "定价已保存" }),
        { closeButton: true },
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (updated: ModelPricing) => {
    const next = pricing.map((p) =>
      p.model === updated.model ? updated : p,
    );
    await saveAll(next);
    setEditingModel(null);
  };

  const handleAdd = async (p: ModelPricing) => {
    const next = [...pricing, p];
    await saveAll(next);
    setIsAddingNew(false);
  };

  const handleDelete = async (model: string) => {
    const next = pricing.filter((p) => p.model !== model);
    await saveAll(next);
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("usage.pricing.hint", {
            defaultValue: "每百万 tokens 的价格（USD）",
          })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setIsAddingNew(true);
            setEditingModel(null);
          }}
          disabled={isAddingNew}
        >
          <Plus size={12} />
          {t("usage.pricing.add", { defaultValue: "添加定价" })}
        </Button>
      </div>

      <div className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("usage.model", { defaultValue: "模型" })}
              </TableHead>
              <TableHead className="text-right">
                {t("usage.pricing.inputPrice", { defaultValue: "输入价格/M" })}
              </TableHead>
              <TableHead className="text-right">
                {t("usage.pricing.outputPrice", {
                  defaultValue: "输出价格/M",
                })}
              </TableHead>
              <TableHead className="text-right w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isAddingNew && (
              <EditRow
                initial={EMPTY}
                onSave={handleAdd}
                onCancel={() => setIsAddingNew(false)}
                existingModels={pricing.map((p) => p.model)}
                isNew={true}
              />
            )}
            {pricing.length === 0 && !isAddingNew ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-8 text-sm"
                >
                  {t("usage.pricing.empty", { defaultValue: "暂无自定义定价" })}
                </TableCell>
              </TableRow>
            ) : (
              pricing.map((p) =>
                editingModel === p.model ? (
                  <EditRow
                    key={p.model}
                    initial={p}
                    onSave={handleEdit}
                    onCancel={() => setEditingModel(null)}
                    existingModels={[]}
                    isNew={false}
                  />
                ) : (
                  <TableRow key={p.model}>
                    <TableCell className="font-mono text-sm">
                      {p.model}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {fmtUsd(p.inputPricePerMillion, 2)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {fmtUsd(p.outputPricePerMillion, 2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            setEditingModel(p.model);
                            setIsAddingNew(false);
                          }}
                          disabled={saving}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:text-destructive"
                          onClick={() => setDeleteTarget(p.model)}
                          disabled={saving}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title={t("usage.pricing.deleteTitle", { defaultValue: "删除定价" })}
          message={t("usage.pricing.deleteConfirm", {
            model: deleteTarget,
            defaultValue: `确定删除 "${deleteTarget}" 的定价配置？`,
          })}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};
