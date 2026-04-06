import React, { useState, useRef, useEffect } from "react";
import { X, FolderOpen, ChevronDown } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import type { SessionConfig } from "../../types";

const colorLabels = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#9ca3af", "#374151",
];

const SHELL_OPTIONS = [
  { value: "cmd",         label: "cmd" },
  { value: "bash",        label: "bash" },
  { value: "powershell",  label: "powershell" },
  { value: "powershell7", label: "powershell7" },
  { value: "wsl",         label: "wsl" },
  { value: "zsh",         label: "zsh" },
  { value: "fish",        label: "fish" },
];

// ---- Custom shell picker dropdown ----
const ShellPicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="shell-picker" style={{ position: "relative" }}>
      <button
        type="button"
        className="shell-picker-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value || "powershell"}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="shell-picker-list">
          {SHELL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`shell-picker-item ${value === opt.value ? "active" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---- Modal ----
export const LocalTerminalModal: React.FC = () => {
  const { showLocalTerminalModal, setShowLocalTerminalModal, addSession, addTab } = useAppStore();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: "",
    color_label: "",
    shell: "powershell",
    working_dir: "",
    remark: "",
  });

  useEffect(() => {
    if (showLocalTerminalModal) {
      setForm({ name: "", color_label: "", shell: "powershell", working_dir: "", remark: "" });
      setTouched({});
    }
  }, [showLocalTerminalModal]);

  if (!showLocalTerminalModal) return null;

  const handleClose = () => setShowLocalTerminalModal(false);

  const handlePickDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "选择工作目录" });
      if (typeof selected === "string" && selected) {
        setForm((prev) => ({ ...prev, working_dir: selected }));
      }
    } catch { /* canceled */ }
  };

  const buildConfig = (sessionId: string): SessionConfig => ({
    id: sessionId,
    name: form.name,
    session_type: "localshell",
    auth_method: "password",
    color_label: form.color_label || undefined,
    shell_name: form.shell,
    working_dir: form.working_dir || undefined,
    remark: form.remark || undefined,
    created_at: new Date().toISOString().slice(0, 10),
  });

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;
    addSession(buildConfig(crypto.randomUUID()));
    handleClose();
  };

  const handleTestConnect = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const sessionId = crypto.randomUUID();
    addSession(buildConfig(sessionId));
    addTab({ id: crypto.randomUUID(), sessionId, title: form.name, type: "localshell", connected: false });
    handleClose();
  };

  const nameError = touched.name && !form.name;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>终端配置编辑</h2>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="ssh-modal-body">
          {/* Row: color + name */}
          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>颜色标签</label>
              <div className="color-label-row">
                {colorLabels.map((color) => (
                  <button
                    key={color}
                    className={`color-dot ${form.color_label === color ? "selected" : ""}`}
                    style={{ background: color }}
                    onClick={() => setForm({ ...form, color_label: color })}
                  />
                ))}
                <button className="color-dot-clear" onClick={() => setForm({ ...form, color_label: "" })}>
                  <X size={11} />
                </button>
              </div>
            </div>
            <div className="ssh-form-group">
              <label className={nameError ? "label-error" : ""}>名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => setTouched((p) => ({ ...p, name: true }))}
                className={nameError ? "input-error" : ""}
                placeholder="My Terminal"
              />
              {nameError && <span className="field-error">name is a required field</span>}
            </div>
          </div>

          {/* Shell picker */}
          <div className="ssh-form-group">
            <label>Shell</label>
            <ShellPicker value={form.shell} onChange={(v) => setForm({ ...form, shell: v })} />
          </div>

          {/* Working directory */}
          <div className="ssh-form-group">
            <label>工作目录</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={form.working_dir}
                onChange={(e) => setForm({ ...form, working_dir: e.target.value })}
                onDoubleClick={handlePickDir}
                placeholder="留空则使用主目录，双击选择目录"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={handlePickDir}
                title="选择目录"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  height: 32, width: 32, borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg-secondary)", color: "var(--text-secondary)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

          {/* Remark */}
          <div className="ssh-form-group">
            <label>备注</label>
            <textarea
              className="ssh-remark"
              rows={3}
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleTestConnect}>测试连接</button>
          <button className="btn btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};