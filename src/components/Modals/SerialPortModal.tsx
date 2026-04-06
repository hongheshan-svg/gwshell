import React, { useState } from "react";
import { X, Plus, Eye, Monitor, CornerDownLeft } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import type { SessionConfig } from "../../types";

const colorLabels = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981",
  "#06b6d4", "#3b82f6", "#a855f7", "#9ca3af",
];

const serialTabs = ["标准", "高级"];

const BAUD_RATES = ["300","600","1200","2400","4800","9600","14400","19200","38400","57600","115200","230400","460800","921600"];
const DATA_BITS = ["5","6","7","8"];
const STOP_BITS = ["1","1.5","2"];
const PARITY_OPTIONS = ["无校验(None)","奇校验(Odd)","偶校验(Even)","标记(Mark)","空格(Space)"];
const ENCODINGS = ["UTF-8","GBK","GB2312","GB18030","ASCII","ISO-8859-1","Shift-JIS"];

interface AutoFillRow {
  id: string;
  pattern: string;
  content: string;
  enabled: boolean;
  sequential: boolean;
  autoEnter: boolean;
}

const makeRow = (): AutoFillRow => ({
  id: crypto.randomUUID(),
  pattern: "",
  content: "",
  enabled: true,
  sequential: false,
  autoEnter: true,
});

interface SerialForm {
  name: string;
  color_label: string;
  serial_port: string;
  serial_baud_rate: string;
  serial_data_bits: string;
  serial_stop_bits: string;
  serial_parity: string;
  serial_encoding: string;
  serial_init_commands: string;
  backspace_remap: boolean;
  record_log: boolean;
  autofill_rows: AutoFillRow[];
  remark: string;
}

const defaultAutofillRows: AutoFillRow[] = [
  { id: "1", pattern: "Username:", content: "", enabled: true, sequential: false, autoEnter: true },
  { id: "2", pattern: "Password:", content: "", enabled: true, sequential: false, autoEnter: true },
];

const defaultForm: SerialForm = {
  name: "",
  color_label: "",
  serial_port: "",
  serial_baud_rate: "115200",
  serial_data_bits: "8",
  serial_stop_bits: "1",
  serial_parity: "无校验(None)",
  serial_encoding: "UTF-8",
  serial_init_commands: "",
  backspace_remap: true,
  record_log: false,
  autofill_rows: defaultAutofillRows,
  remark: "",
};

export const SerialPortModal: React.FC = () => {
  const { showSerialModal, setShowSerialModal, addSession, addTab } = useAppStore();
  const [activeTab, setActiveTab] = useState("标准");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<SerialForm>({ ...defaultForm, autofill_rows: defaultAutofillRows.map((r) => ({ ...r })) });

  React.useEffect(() => {
    if (showSerialModal) {
      setForm({ ...defaultForm, autofill_rows: defaultAutofillRows.map((r) => ({ ...r })) });
      setTouched({});
      setActiveTab("标准");
    }
  }, [showSerialModal]);

  if (!showSerialModal) return null;

  const handleClose = () => setShowSerialModal(false);

  const setField = <K extends keyof SerialForm>(key: K, value: SerialForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const updateRow = (id: string, patch: Partial<AutoFillRow>) => {
    setForm((prev) => ({
      ...prev,
      autofill_rows: prev.autofill_rows.map((r) => r.id === id ? { ...r, ...patch } : r),
    }));
  };

  const addRow = () => {
    setForm((prev) => ({ ...prev, autofill_rows: [...prev.autofill_rows, makeRow()] }));
  };

  const removeRow = (id: string) => {
    setForm((prev) => ({ ...prev, autofill_rows: prev.autofill_rows.filter((r) => r.id !== id) }));
  };

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const now = new Date().toISOString().slice(0, 10);
    const config: SessionConfig = {
      id: crypto.randomUUID(),
      name: form.name,
      session_type: "serial",
      auth_method: "password",
      color_label: form.color_label || undefined,
      serial_port: form.serial_port || undefined,
      serial_baud_rate: form.serial_baud_rate,
      serial_data_bits: form.serial_data_bits,
      serial_stop_bits: form.serial_stop_bits,
      serial_parity: form.serial_parity,
      serial_encoding: form.serial_encoding,
      serial_init_commands: form.serial_init_commands || undefined,
      remark: form.remark || undefined,
      created_at: now,
    };
    addSession(config);
    const tabId = crypto.randomUUID();
    addTab({ id: tabId, sessionId: config.id, title: config.name, type: "serial", connected: false });
    handleClose();
  };

  const handleTest = () => {
    setTouched({ name: true });
    if (!form.name) return;
    handleSave();
  };

  const nameError = touched.name && !form.name;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" style={{ width: 580 }} onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-header">
          <h2>串口配置编辑</h2>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        <div className="ssh-modal-tabs" style={{ justifyContent: "center" }}>
          {serialTabs.map((tab) => (
            <button key={tab} className={`ssh-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>

        <div className="ssh-modal-body">
          {activeTab === "标准" && (
            <>
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>颜色标签</label>
                  <div className="color-label-row">
                    {colorLabels.map((color) => (
                      <button key={color} className={`color-dot ${form.color_label === color ? "selected" : ""}`}
                        style={{ background: color }} onClick={() => setField("color_label", color)} />
                    ))}
                    <button className="color-dot-clear" onClick={() => setField("color_label", "")}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
                <div className="ssh-form-group">
                  <label className={nameError ? "label-error" : ""}>名称</label>
                  <input type="text" value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    onBlur={() => handleBlur("name")}
                    className={nameError ? "input-error" : ""} placeholder="请输入名称" />
                  {nameError && <span className="field-error">name is a required field</span>}
                </div>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>串口</label>
                  <select value={form.serial_port} onChange={(e) => setField("serial_port", e.target.value)}>
                    <option value=""></option>
                    {["COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8",
                      "/dev/ttyS0","/dev/ttyS1","/dev/ttyUSB0","/dev/ttyUSB1"].map((p) =>
                      <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>波特率</label>
                  <select value={form.serial_baud_rate} onChange={(e) => setField("serial_baud_rate", e.target.value)}>
                    {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>数据位</label>
                  <select value={form.serial_data_bits} onChange={(e) => setField("serial_data_bits", e.target.value)}>
                    {DATA_BITS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>停止位</label>
                  <select value={form.serial_stop_bits} onChange={(e) => setField("serial_stop_bits", e.target.value)}>
                    {STOP_BITS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>校验位</label>
                  <select value={form.serial_parity} onChange={(e) => setField("serial_parity", e.target.value)}>
                    {PARITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>字符编码</label>
                  <select value={form.serial_encoding} onChange={(e) => setField("serial_encoding", e.target.value)}>
                    {ENCODINGS.map((enc) => <option key={enc} value={enc}>{enc}</option>)}
                  </select>
                </div>
              </div>

              <div className="ssh-form-group">
                <label>初始执行命令</label>
                <textarea rows={4} value={form.serial_init_commands}
                  onChange={(e) => setField("serial_init_commands", e.target.value)}
                  placeholder="连接成功后自动执行的命令，每行一条" />
              </div>
            </>
          )}

          {activeTab === "高级" && (
            <>
              <div className="autofill-section">
                <div className="autofill-header">
                  <div className="autofill-header-left">
                    <span className="autofill-title">自动填写配置</span>
                    <span className="autofill-subtitle">用于自动登录</span>
                  </div>
                  <div className="autofill-header-right">
                    <label className="autofill-check-label">
                      <input type="checkbox" checked={form.backspace_remap}
                        onChange={(e) => setField("backspace_remap", e.target.checked)} />
                      <span>退格映射^H</span>
                    </label>
                    <label className="autofill-check-label">
                      <input type="checkbox" checked={form.record_log}
                        onChange={(e) => setField("record_log", e.target.checked)} />
                      <span>录制日志</span>
                    </label>
                    <button className="autofill-add-btn" onClick={addRow} title="添加行">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <div className="autofill-rows">
                  {form.autofill_rows.map((row) => (
                    <div key={row.id} className="autofill-row">
                      <div className="autofill-input-wrap autofill-pattern">
                        <Eye size={13} className="autofill-icon" />
                        <input className="autofill-input" value={row.pattern}
                          onChange={(e) => updateRow(row.id, { pattern: e.target.value })}
                          placeholder="匹配内容" />
                      </div>

                      <span className="autofill-arrow">&#8594;</span>

                      <div className="autofill-input-wrap autofill-content">
                        <Monitor size={13} className="autofill-icon" />
                        <input className="autofill-input" value={row.content}
                          onChange={(e) => updateRow(row.id, { content: e.target.value })}
                          placeholder="自动发送内容" />
                      </div>

                      <div className="autofill-controls">
                        <button className={`autofill-ctrl-btn ${row.enabled ? "ctrl-green" : ""}`}
                          onClick={() => updateRow(row.id, { enabled: !row.enabled })} title="启用">
                          &#10003;
                        </button>
                        <span className="autofill-seq">&#9312;</span>
                        <button className={`autofill-ctrl-btn ${row.sequential ? "ctrl-green" : ""}`}
                          onClick={() => updateRow(row.id, { sequential: !row.sequential })} title="匹配后发送">
                          &#10003;
                        </button>
                        <button className={`autofill-ctrl-btn ${row.autoEnter ? "ctrl-blue" : ""}`}
                          onClick={() => updateRow(row.id, { autoEnter: !row.autoEnter })} title="自带回车">
                          <CornerDownLeft size={12} />
                        </button>
                        <button className="autofill-ctrl-btn ctrl-red" onClick={() => removeRow(row.id)} title="删除">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ssh-form-group" style={{ marginTop: 16 }}>
                <label>备注</label>
                <textarea rows={3} value={form.remark}
                  onChange={(e) => setField("remark", e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleTest}>测试连接</button>
          <button className="btn btn-primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};