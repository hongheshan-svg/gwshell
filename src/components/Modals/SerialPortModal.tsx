import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { SessionConfig } from '../../types';

const colorLabels = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#a855f7', '#9ca3af',
];

const serialTabs = ['标准', '高级'];

const BAUD_RATES = ['300', '600', '1200', '2400', '4800', '9600', '14400', '19200',
  '38400', '57600', '115200', '230400', '460800', '921600'];
const DATA_BITS = ['5', '6', '7', '8'];
const STOP_BITS = ['1', '1.5', '2'];
const PARITY_OPTIONS = ['无校验(None)', '奇校验(Odd)', '偶校验(Even)', '标记(Mark)', '空格(Space)'];
const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'GB18030', 'ASCII', 'ISO-8859-1', 'Shift-JIS'];
const FLOW_CONTROLS = ['无(None)', 'RTS/CTS', 'XON/XOFF', 'DTR/DSR'];

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
  // Advanced
  flow_control: string;
  rts: boolean;
  dtr: boolean;
  local_echo: boolean;
  reconnect_on_disconnect: boolean;
  remark: string;
}

const defaultForm: SerialForm = {
  name: '',
  color_label: '',
  serial_port: '',
  serial_baud_rate: '115200',
  serial_data_bits: '8',
  serial_stop_bits: '1',
  serial_parity: '无校验(None)',
  serial_encoding: 'UTF-8',
  serial_init_commands: '',
  flow_control: '无(None)',
  rts: false,
  dtr: false,
  local_echo: false,
  reconnect_on_disconnect: false,
  remark: '',
};

export const SerialPortModal: React.FC = () => {
  const { showSerialModal, setShowSerialModal, addSession, addTab } = useAppStore();
  const [activeTab, setActiveTab] = useState('标准');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<SerialForm>({ ...defaultForm });

  React.useEffect(() => {
    if (showSerialModal) {
      setForm({ ...defaultForm });
      setTouched({});
      setActiveTab('标准');
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

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;

    const now = new Date().toISOString().slice(0, 10);
    const config: SessionConfig = {
      id: crypto.randomUUID(),
      name: form.name,
      session_type: 'serial',
      auth_method: 'password',
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
    addTab({
      id: tabId,
      sessionId: config.id,
      title: config.name,
      type: 'serial',
      connected: false,
    });
    handleClose();
  };

  const handleTest = () => {
    setTouched({ name: true });
    if (!form.name) return;
    // TODO: invoke Tauri command to test serial connection
    handleSave();
  };

  const nameError = touched.name && !form.name;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="ssh-modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssh-modal-header">
          <h2>串口配置编辑</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="ssh-modal-tabs" style={{ justifyContent: 'center' }}>
          {serialTabs.map((tab) => (
            <button
              key={tab}
              className={`ssh-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="ssh-modal-body">
          {activeTab === '标准' && (
            <>
              {/* Row 1: Color label + Name */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>颜色标签</label>
                  <div className="color-label-row">
                    {colorLabels.map((color) => (
                      <button
                        key={color}
                        className={`color-dot ${form.color_label === color ? 'selected' : ''}`}
                        style={{ background: color }}
                        onClick={() => setField('color_label', color)}
                      />
                    ))}
                    <button
                      className="color-dot-clear"
                      onClick={() => setField('color_label', '')}
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
                <div className="ssh-form-group">
                  <label className={nameError ? 'label-error' : ''}>名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    onBlur={() => handleBlur('name')}
                    className={nameError ? 'input-error' : ''}
                    placeholder="请输入名称"
                  />
                  {nameError && <span className="field-error">name is a required field</span>}
                </div>
              </div>

              {/* Row 2: 串口 + 波特率 */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>串口</label>
                  <select
                    value={form.serial_port}
                    onChange={(e) => setField('serial_port', e.target.value)}
                  >
                    <option value=""></option>
                    <option value="COM1">COM1</option>
                    <option value="COM2">COM2</option>
                    <option value="COM3">COM3</option>
                    <option value="COM4">COM4</option>
                    <option value="COM5">COM5</option>
                    <option value="COM6">COM6</option>
                    <option value="COM7">COM7</option>
                    <option value="COM8">COM8</option>
                    <option value="/dev/ttyS0">/dev/ttyS0</option>
                    <option value="/dev/ttyS1">/dev/ttyS1</option>
                    <option value="/dev/ttyUSB0">/dev/ttyUSB0</option>
                    <option value="/dev/ttyUSB1">/dev/ttyUSB1</option>
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>波特率</label>
                  <select
                    value={form.serial_baud_rate}
                    onChange={(e) => setField('serial_baud_rate', e.target.value)}
                  >
                    {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 3: 数据位 + 停止位 */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>数据位</label>
                  <select
                    value={form.serial_data_bits}
                    onChange={(e) => setField('serial_data_bits', e.target.value)}
                  >
                    {DATA_BITS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>停止位</label>
                  <select
                    value={form.serial_stop_bits}
                    onChange={(e) => setField('serial_stop_bits', e.target.value)}
                  >
                    {STOP_BITS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 4: 校验位 + 字符编码 */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>校验位</label>
                  <select
                    value={form.serial_parity}
                    onChange={(e) => setField('serial_parity', e.target.value)}
                  >
                    {PARITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>字符编码</label>
                  <select
                    value={form.serial_encoding}
                    onChange={(e) => setField('serial_encoding', e.target.value)}
                  >
                    {ENCODINGS.map((enc) => <option key={enc} value={enc}>{enc}</option>)}
                  </select>
                </div>
              </div>

              {/* 初始执行命令 */}
              <div className="ssh-form-group">
                <label>初始执行命令</label>
                <textarea
                  rows={4}
                  value={form.serial_init_commands}
                  onChange={(e) => setField('serial_init_commands', e.target.value)}
                  placeholder="连接成功后自动执行的命令，每行一条"
                />
              </div>
            </>
          )}

          {activeTab === '高级' && (
            <>
              {/* Row 1: 流控制 */}
              <div className="ssh-form-row">
                <div className="ssh-form-group">
                  <label>流量控制</label>
                  <select
                    value={form.flow_control}
                    onChange={(e) => setField('flow_control', e.target.value)}
                  >
                    {FLOW_CONTROLS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="ssh-form-group">
                  <label>备注</label>
                  <input
                    type="text"
                    value={form.remark}
                    onChange={(e) => setField('remark', e.target.value)}
                    placeholder="可选备注"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="ssh-form-group">
                <label>高级选项</label>
                <div className="serial-adv-toggles">
                  <label className="serial-adv-toggle-row">
                    <input
                      type="checkbox"
                      checked={form.rts}
                      onChange={(e) => setField('rts', e.target.checked)}
                    />
                    <span>RTS (请求发送)</span>
                  </label>
                  <label className="serial-adv-toggle-row">
                    <input
                      type="checkbox"
                      checked={form.dtr}
                      onChange={(e) => setField('dtr', e.target.checked)}
                    />
                    <span>DTR (数据终端就绪)</span>
                  </label>
                  <label className="serial-adv-toggle-row">
                    <input
                      type="checkbox"
                      checked={form.local_echo}
                      onChange={(e) => setField('local_echo', e.target.checked)}
                    />
                    <span>本地回显 (Local Echo)</span>
                  </label>
                  <label className="serial-adv-toggle-row">
                    <input
                      type="checkbox"
                      checked={form.reconnect_on_disconnect}
                      onChange={(e) => setField('reconnect_on_disconnect', e.target.checked)}
                    />
                    <span>断开后自动重连</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="ssh-modal-footer">
          <button className="ssh-footer-link" onClick={handleTest}>
            测试连接
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
