import React, { useState, useRef, useEffect } from "react";
import { X, FolderOpen, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../stores/appStore";
import type { SessionConfig } from "../../types";

const colorLabels = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#9ca3af", "#374151",
];

const CHARSETS = [
  "UTF-8", "GBK", "GB2312", "GB18030", "Big5",
  "Shift-JIS", "EUC-JP", "EUC-KR", "KOI8-R",
  "Windows-1252", "ISO-8859-1", "ASCII",
];

interface ShellOption {
  id: string;
  label: string;
}

// ---- Custom shell picker dropdown ----
const ShellPicker: React.FC<{
  value: string;
  options: ShellOption[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => {
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

  const currentLabel = options.find((o) => o.id === value)?.label ?? value;

  return (
    <div ref={ref} className="shell-picker" style={{ position: "relative" }}>
      <button
        type="button"
        className="shell-picker-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{currentLabel || "powershell"}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="shell-picker-list">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`shell-picker-item ${value === opt.id ? "active" : ""}`}
              onClick={() => { onChange(opt.id); setOpen(false); }}
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
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([
    { id: "powershell", label: "powershell" },
  ]);
  const [form, setForm] = useState({
    name: "",
    color_label: "",
    shell: "powershell",
    charset: "UTF-8",
    working_dir: "",
    remark: "",
  });

  useEffect(() => {
    if (showLocalTerminalModal) {
      setForm({ name: "", color_label: "", shell: "powershell", charset: "UTF-8", working_dir: "", remark: "" });
      setTouched({});
      // Load available shells from backend
      invoke<ShellOption[]>("list_shells")
        .then((list) => {
          setShellOptions(list);
          // Default to first non-custom shell
          const first = list.find((s) => s.id !== "custom");
          if (first) setForm((f) => ({ ...f, shell: first.id }));
        })
        .catch(() => {/* keep default */});
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
    charset: form.charset,
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
            <ShellPicker value={form.shell} options={shellOptions} onChange={(v) => setForm({ ...form, shell: v })} />
          </div>

          {/* Charset */}
          <div className="ssh-form-group">
            <label>字符集</label>
            <select
              value={form.charset}
              onChange={(e) => setForm({ ...form, charset: e.target.value })}
              style={{
                width: "100%", height: 32, borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)", color: "var(--text)",
                padding: "0 8px", fontSize: 13, cursor: "pointer",
              }}
            >
              {CHARSETS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
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