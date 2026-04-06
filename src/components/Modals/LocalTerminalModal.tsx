import React, { useState } from "react";
import { X, FolderOpen } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import type { SessionConfig } from "../../types";

const colorLabels = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981",
  "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#9ca3af", "#374151",
];

const shellOptions = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL (Bash)" },
  { value: "gitbash", label: "Git Bash" },
];

export const LocalTerminalModal: React.FC = () => {
  const { showLocalTerminalModal, setShowLocalTerminalModal, addSession, addTab } = useAppStore();

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    name: "",
    color_label: "",
    environment: "",
    shell: "powershell",
    working_dir: "",
    remark: "",
  });

  React.useEffect(() => {
    if (showLocalTerminalModal) {
      setForm({
        name: "",
        color_label: "",
        environment: "",
        shell: "powershell",
        working_dir: "",
        remark: "",
      });
      setTouched({});
    }
  }, [showLocalTerminalModal]);

  if (!showLocalTerminalModal) return null;

  const handleClose = () => setShowLocalTerminalModal(false);

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handlePickDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "选择工作目录" });
      if (typeof selected === "string" && selected) {
        setForm((prev) => ({ ...prev, working_dir: selected }));
      }
    } catch {
      // dialog canceled or unavailable
    }
  };

  const buildConfig = (sessionId: string): SessionConfig => {
    const now = new Date().toISOString().slice(0, 10);
    return {
      id: sessionId,
      name: form.name,
      session_type: "localshell",
      auth_method: "password",
      color_label: form.color_label || undefined,
      environment: form.environment || undefined,
      working_dir: form.working_dir || undefined,
      remark: form.remark || undefined,
      created_at: now,
    };
  };

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;
    addSession(buildConfig(crypto.randomUUID()));
    handleClose();
  };

  const handleOpen = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const sessionId = crypto.randomUUID();
    addSession(buildConfig(sessionId));
    addTab({
      id: crypto.randomUUID(),
      sessionId,
      title: form.name,
      type: "localshell",
      connected: false,
    });
    handleClose();
  };

  const nameError = touched.name && !form.name;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-header">
          <h2>本地终端配置</h2>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        <div className="ssh-modal-body">
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
              <label>环境</label>
              <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                <option value="">无</option>
                <option value="dev">开发</option>
                <option value="staging">测试</option>
                <option value="production">生产</option>
              </select>
            </div>
          </div>

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label className={nameError ? "label-error" : ""}>名称</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => handleBlur("name")}
                className={nameError ? "input-error" : ""}
                placeholder="My Terminal"
              />
              {nameError && <span className="field-error">name is a required field</span>}
            </div>
            <div className="ssh-form-group">
              <label>Shell</label>
              <select value={form.shell} onChange={(e) => setForm({ ...form, shell: e.target.value })}>
                {shellOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ssh-form-group">
            <label>工作目录</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
                  height: 32, width: 32, borderRadius: 6, border: "1px solid var(--border)",
                  background: "var(--bg-secondary)", color: "var(--text-secondary)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                <FolderOpen size={15} />
              </button>
            </div>
          </div>

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

        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleOpen}>打开终端</button>
          <button className="ssh-footer-link" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};