import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores/appStore';
import { useEscapeClose } from '../../lib/useEscapeClose';
import { GroupSelectField } from './GroupSelectField';
import { ColorLabelPicker } from './ColorLabelPicker';
import type { SessionConfig } from '../../types';

const BAUD_RATES = [
  '300',
  '600',
  '1200',
  '2400',
  '4800',
  '9600',
  '14400',
  '19200',
  '38400',
  '57600',
  '115200',
  '230400',
  '460800',
  '921600',
];
const DATA_BITS = ['5', '6', '7', '8'];
const STOP_BITS = ['1', '2'];
const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'GB18030', 'ASCII', 'ISO-8859-1', 'Shift-JIS'];

interface SerialForm {
  name: string;
  group: string;
  color_label: string;
  serial_port: string;
  serial_baud_rate: string;
  serial_data_bits: string;
  serial_stop_bits: string;
  serial_parity: 'None' | 'Odd' | 'Even';
  serial_encoding: string;
  serial_flow_control: string;
  serial_init_commands: string;
  remark: string;
}

function narrowFlowControl(value: string): 'none' | 'software' | 'hardware' {
  if (value === 'software' || value === 'hardware') return value;
  return 'none';
}

function normalizeParity(value?: string): 'None' | 'Odd' | 'Even' {
  const lower = (value ?? '').toLowerCase();
  if (lower.includes('odd')) return 'Odd';
  if (lower.includes('even')) return 'Even';
  return 'None';
}

const defaultForm: SerialForm = {
  name: '',
  group: '',
  color_label: '',
  serial_port: '',
  serial_baud_rate: '115200',
  serial_data_bits: '8',
  serial_stop_bits: '1',
  serial_parity: 'None',
  serial_encoding: 'UTF-8',
  serial_flow_control: 'none',
  serial_init_commands: '',
  remark: '',
};

export const SerialPortModal: React.FC = () => {
  const showSerialModal = useAppStore((s) => s.showSerialModal);
  const setShowSerialModal = useAppStore((s) => s.setShowSerialModal);
  const editingSession = useAppStore((s) => s.editingSession);
  const setEditingSession = useAppStore((s) => s.setEditingSession);
  const addSession = useAppStore((s) => s.addSession);
  const addTab = useAppStore((s) => s.addTab);
  const { t } = useTranslation();
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<SerialForm>({ ...defaultForm });
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);

  const isEditing = editingSession?.session_type === 'serial';

  useEffect(() => {
    if (!showSerialModal) return;
    if (editingSession?.session_type === 'serial') {
      setForm({
        ...defaultForm,
        name: editingSession.name,
        group: editingSession.group ?? '',
        color_label: editingSession.color_label ?? '',
        serial_port: editingSession.serial_port ?? '',
        serial_baud_rate: editingSession.serial_baud_rate ?? '115200',
        serial_data_bits: editingSession.serial_data_bits ?? '8',
        serial_stop_bits: editingSession.serial_stop_bits === '2' ? '2' : '1',
        serial_parity: normalizeParity(editingSession.serial_parity),
        serial_encoding: editingSession.serial_encoding ?? 'UTF-8',
        serial_flow_control: editingSession.serial_flow_control ?? 'none',
        serial_init_commands: editingSession.serial_init_commands ?? '',
        remark: editingSession.remark ?? '',
      });
    } else {
      setForm({ ...defaultForm });
    }
    setTouched({});
    invoke<string[]>('list_serial_ports')
      .then((ports) => setAvailablePorts(ports))
      .catch(() => setAvailablePorts([]));
  }, [showSerialModal, editingSession]);

  const handleClose = () => {
    setShowSerialModal(false);
    setEditingSession(null);
  };
  useEscapeClose(handleClose);

  if (!showSerialModal) return null;

  const setField = <K extends keyof SerialForm>(key: K, value: SerialForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const buildConfig = (): SessionConfig => ({
    id: isEditing ? editingSession.id : crypto.randomUUID(),
    name: form.name,
    session_type: 'serial',
    auth_method: 'password',
    group: form.group.trim() || undefined,
    color_label: form.color_label || undefined,
    serial_port: form.serial_port || undefined,
    serial_baud_rate: form.serial_baud_rate,
    serial_data_bits: form.serial_data_bits,
    serial_stop_bits: form.serial_stop_bits,
    serial_parity: form.serial_parity,
    serial_encoding: form.serial_encoding,
    serial_flow_control: narrowFlowControl(form.serial_flow_control),
    serial_init_commands: form.serial_init_commands || undefined,
    remark: form.remark || undefined,
    created_at: isEditing ? editingSession.created_at : new Date().toISOString().slice(0, 10),
  });

  const handleSave = () => {
    setTouched({ name: true });
    if (!form.name) return;
    addSession(buildConfig());
    handleClose();
  };

  const handleTest = () => {
    setTouched({ name: true });
    if (!form.name) return;
    const config = buildConfig();
    addSession(config);
    const existingTab = useAppStore.getState().tabs.find((tb) => tb.sessionId === config.id);
    if (existingTab) {
      useAppStore.getState().setActiveTab(existingTab.id);
    } else {
      addTab({
        id: crypto.randomUUID(),
        sessionId: config.id,
        title: config.name,
        type: 'serial',
        connected: false,
      });
    }
    handleClose();
  };

  const nameError = touched.name && !form.name;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="ssh-modal" style={{ width: 580 }} onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-header">
          <h2>{t('serial_config_title')}</h2>
          <button type="button" className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ssh-modal-body">
          <div className="ssh-form-row">
            <ColorLabelPicker
              value={form.color_label}
              onChange={(color_label) => setField('color_label', color_label)}
            />
            <div className="ssh-form-group">
              <label className={nameError ? 'label-error' : ''}>
                {t('ssh_name')} <span className="required-mark">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                onBlur={() => handleBlur('name')}
                className={nameError ? 'input-error' : ''}
                placeholder={t('serial_name_placeholder')}
              />
              {nameError && <span className="field-error">{t('field_required')}</span>}
            </div>
          </div>

          <GroupSelectField value={form.group} onChange={(group) => setField('group', group)} />

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>{t('serial_port')}</label>
              <select
                value={form.serial_port}
                onChange={(e) => setField('serial_port', e.target.value)}
              >
                <option value="">{t('serial_select_port')}</option>
                {availablePorts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {availablePorts.length === 0 &&
                  ['COM1', 'COM2', 'COM3', 'COM4', '/dev/ttyUSB0', '/dev/ttyUSB1'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            </div>
            <div className="ssh-form-group">
              <label>{t('serial_baud_rate')}</label>
              <select
                value={form.serial_baud_rate}
                onChange={(e) => setField('serial_baud_rate', e.target.value)}
              >
                {BAUD_RATES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>{t('serial_data_bits')}</label>
              <select
                value={form.serial_data_bits}
                onChange={(e) => setField('serial_data_bits', e.target.value)}
              >
                {DATA_BITS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="ssh-form-group">
              <label>{t('serial_stop_bits')}</label>
              <select
                value={form.serial_stop_bits}
                onChange={(e) => setField('serial_stop_bits', e.target.value)}
              >
                {STOP_BITS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>{t('serial_parity')}</label>
              <select
                value={form.serial_parity}
                onChange={(e) => setField('serial_parity', normalizeParity(e.target.value))}
              >
                <option value="None">{t('serial_parity_none')}</option>
                <option value="Odd">{t('serial_parity_odd')}</option>
                <option value="Even">{t('serial_parity_even')}</option>
              </select>
            </div>
            <div className="ssh-form-group">
              <label>{t('serial_encoding')}</label>
              <select
                value={form.serial_encoding}
                onChange={(e) => setField('serial_encoding', e.target.value)}
              >
                {ENCODINGS.map((enc) => (
                  <option key={enc} value={enc}>
                    {enc}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ssh-form-row">
            <div className="ssh-form-group">
              <label>{t('serial_flow_control')}</label>
              <select
                value={form.serial_flow_control}
                onChange={(e) => setField('serial_flow_control', e.target.value)}
              >
                <option value="none">{t('serial_flow_control_none')}</option>
                <option value="software">{t('serial_flow_control_software')}</option>
                <option value="hardware">{t('serial_flow_control_hardware')}</option>
              </select>
            </div>
          </div>

          <div className="ssh-form-group">
            <label>{t('serial_init_commands')}</label>
            <textarea
              rows={3}
              value={form.serial_init_commands}
              onChange={(e) => setField('serial_init_commands', e.target.value)}
              placeholder={t('serial_init_placeholder')}
            />
          </div>

          <div className="ssh-form-group">
            <label>{t('ssh_remark')}</label>
            <textarea
              rows={2}
              value={form.remark}
              onChange={(e) => setField('remark', e.target.value)}
            />
          </div>
        </div>

        <div className="ssh-modal-footer">
          <button type="button" className="ssh-footer-link" onClick={handleTest}>
            {t('ssh_save_and_connect')}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            {t('ssh_save')}
          </button>
        </div>
      </div>
    </div>
  );
};
