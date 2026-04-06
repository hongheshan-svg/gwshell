import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/* ---- Setting nav categories ---- */
interface NavCategory {
  title?: string;
  items: { id: string; label: string }[];
}

const navCategories: NavCategory[] = [
  {
    title: '通用',
    items: [
      { id: 'basic', label: '基础' },
      { id: 'ssh-sftp', label: 'SSH/SFTP' },
      { id: 'database', label: '数据库' },
    ],
  },
  {
    title: 'AI',
    items: [{ id: 'ai', label: '账号' }],
  },
  {
    title: '快捷键',
    items: [
      { id: 'shortcut-basic', label: '基础' },
      { id: 'shortcut-ssh', label: 'SSH/SFTP' },
    ],
  },
  {
    items: [{ id: 'docker', label: 'Docker' }],
  },
  {
    items: [{ id: 'storage', label: '储存仓库' }],
  },
  {
    items: [{ id: 'referral', label: '推介有奖' }],
  },
];

/* ---- Settings state shape ---- */
export interface AppSettings {
  // Basic - left column
  theme: 'dark' | 'light';
  middleClickCloseTab: boolean;
  uiFont: string;
  editorLineEnding: string;
  enableAnimation: boolean;
  showRealtimeInfo: boolean;
  tabCloseButtonPos: string;
  ligatures: boolean;
  mouseWheelZoom: boolean;
  tabCloseConfirm: boolean;
  tabFlashAlert: boolean;
  multiLineTab: boolean;
  // Basic - right column
  language: string;
  updateChannel: string;
  editorFont: string;
  zoomLevel: string;
  editorFontSize: string;
  editorAutoWrap: boolean;
  editorTabMode: string;
  autoLockScreen: boolean;
  autoLockScreenTime: string;
  lockScreenPassword: string;
  sessionTabMemory: boolean;
  showVipBadge: boolean;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  middleClickCloseTab: true,
  uiFont: 'JetBrainsMono, NotoSansSC',
  editorLineEnding: '\\r\\n',
  enableAnimation: false,
  showRealtimeInfo: false,
  tabCloseButtonPos: '靠左',
  ligatures: true,
  mouseWheelZoom: true,
  tabCloseConfirm: true,
  tabFlashAlert: true,
  multiLineTab: false,
  language: '简体中文',
  updateChannel: '稳定通道',
  editorFont: 'JetBrainsMono, NotoSansSC',
  zoomLevel: '100%',
  editorFontSize: '14px',
  editorAutoWrap: false,
  editorTabMode: '制表符\\t',
  autoLockScreen: false,
  autoLockScreenTime: '关闭',
  lockScreenPassword: '',
  sessionTabMemory: false,
  showVipBadge: true,
};

/* ---- Toggle Switch ---- */
const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button
    className={`settings-toggle ${value ? 'on' : ''}`}
    onClick={() => onChange(!value)}
    type="button"
  >
    <span className="settings-toggle-knob" />
  </button>
);

/* ---- Select dropdown ---- */
const SettingsSelect: React.FC<{
  value: string;
  options: string[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <select
    className="settings-select"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  >
    {options.map((opt) => (
      <option key={opt} value={opt}>{opt}</option>
    ))}
  </select>
);

/* ---- Settings row ---- */
const SettingsRow: React.FC<{
  label: string;
  desc?: string;
  children: React.ReactNode;
}> = ({ label, desc, children }) => (
  <div className="settings-row">
    <div className="settings-row-left">
      <span className="settings-label">{label}</span>
      {desc && <span className="settings-desc">{desc}</span>}
    </div>
    <div className="settings-row-right">
      {children}
    </div>
  </div>
);

/* ---- Main Component ---- */
export const SettingsModal: React.FC = () => {
  const { showSettings, setShowSettings, theme, toggleTheme } = useAppStore();
  const [activeNav, setActiveNav] = useState('basic');
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (showSettings) {
      setSettings((prev) => ({ ...prev, theme }));
      setDirty(false);
    }
  }, [showSettings, theme]);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleApply = () => {
    // Apply theme change
    if (settings.theme !== theme) {
      toggleTheme();
    }
    setDirty(false);
  };

  const handleReset = () => {
    setSettings({ ...defaultSettings, theme });
    setDirty(true);
  };

  if (!showSettings) return null;

  const handleClose = () => setShowSettings(false);

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-left">
            <span className="settings-brand">GWShell</span>
          </div>
          <h2>设置</h2>
          <button className="modal-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          {/* Left nav */}
          <div className="settings-nav">
            {navCategories.map((cat, catIdx) => (
              <div key={catIdx} className="settings-nav-group">
                {cat.title && <div className="settings-nav-title">{cat.title}</div>}
                {cat.items.map((item) => (
                  <button
                    key={item.id}
                    className={`settings-nav-item ${activeNav === item.id ? 'active' : ''}`}
                    onClick={() => setActiveNav(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Right content */}
          <div className="settings-content">
            {activeNav === 'basic' && (
              <div className="settings-columns">
                {/* Left column - 基本 */}
                <div className="settings-col">
                  <div className="settings-col-title">基本</div>

                  <SettingsRow label="主题">
                    <SettingsSelect
                      value={settings.theme === 'dark' ? 'Dark' : 'Light'}
                      options={['Dark', 'Light']}
                      onChange={(v) => update('theme', v === 'Dark' ? 'dark' : 'light')}
                    />
                  </SettingsRow>

                  <SettingsRow label="鼠标中键关闭选项卡">
                    <Toggle value={settings.middleClickCloseTab} onChange={(v) => update('middleClickCloseTab', v)} />
                  </SettingsRow>

                  <SettingsRow label="UI字体">
                    <SettingsSelect
                      value={settings.uiFont}
                      options={['JetBrainsMono, NotoSansSC', 'Consolas', 'Cascadia Code', 'Fira Code', 'monospace']}
                      onChange={(v) => update('uiFont', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="编辑器换行符">
                    <SettingsSelect
                      value={settings.editorLineEnding}
                      options={['(兼容) \\r\\n', '\\n', '\\r']}
                      onChange={(v) => update('editorLineEnding', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="是否开启动画">
                    <Toggle value={settings.enableAnimation} onChange={(v) => update('enableAnimation', v)} />
                  </SettingsRow>

                  <SettingsRow label="显示右侧实时信息" desc="关闭后将隐藏服务器实时指标">
                    <Toggle value={settings.showRealtimeInfo} onChange={(v) => update('showRealtimeInfo', v)} />
                  </SettingsRow>

                  <SettingsRow label="Tab栏关闭按钮位置">
                    <SettingsSelect
                      value={settings.tabCloseButtonPos}
                      options={['靠左', '靠右']}
                      onChange={(v) => update('tabCloseButtonPos', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="连体字效果">
                    <Toggle value={settings.ligatures} onChange={(v) => update('ligatures', v)} />
                  </SettingsRow>

                  <SettingsRow label="鼠标滚轮缩放">
                    <Toggle value={settings.mouseWheelZoom} onChange={(v) => update('mouseWheelZoom', v)} />
                  </SettingsRow>

                  <SettingsRow label="标签关闭确认" desc="关闭后SSH、终端等标签关闭时不显示确认提示窗">
                    <Toggle value={settings.tabCloseConfirm} onChange={(v) => update('tabCloseConfirm', v)} />
                  </SettingsRow>

                  <SettingsRow label="标签闪烁提醒" desc="非当前标签页有新活动时，将触发闪烁提醒">
                    <Toggle value={settings.tabFlashAlert} onChange={(v) => update('tabFlashAlert', v)} />
                  </SettingsRow>

                  <SettingsRow label="多行显示标签卡" desc="标签卡过多时以多行方式显示，而不是横向滚动">
                    <Toggle value={settings.multiLineTab} onChange={(v) => update('multiLineTab', v)} />
                  </SettingsRow>
                </div>

                {/* Right column */}
                <div className="settings-col">
                  <div className="settings-col-title" style={{ visibility: 'hidden' }}>_</div>

                  <SettingsRow label="语言">
                    <SettingsSelect
                      value={settings.language}
                      options={['简体中文', 'English', '繁體中文', '日本語']}
                      onChange={(v) => update('language', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="更新通道" desc="修改后需重启生效，通道之间用户不共享">
                    <SettingsSelect
                      value={settings.updateChannel}
                      options={['稳定通道', '测试通道', '开发通道']}
                      onChange={(v) => update('updateChannel', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="编辑器字体">
                    <SettingsSelect
                      value={settings.editorFont}
                      options={['JetBrainsMono, NotoSansSC', 'Consolas', 'Cascadia Code', 'Fira Code', 'monospace']}
                      onChange={(v) => update('editorFont', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="缩放比例">
                    <SettingsSelect
                      value={settings.zoomLevel}
                      options={['80%', '90%', '100%', '110%', '120%', '150%']}
                      onChange={(v) => update('zoomLevel', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="编辑器字号">
                    <SettingsSelect
                      value={settings.editorFontSize}
                      options={['12px', '13px', '14px', '15px', '16px', '18px', '20px']}
                      onChange={(v) => update('editorFontSize', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="编辑器自动换行">
                    <Toggle value={settings.editorAutoWrap} onChange={(v) => update('editorAutoWrap', v)} />
                  </SettingsRow>

                  <SettingsRow label="编辑器Tab键模式">
                    <SettingsSelect
                      value={settings.editorTabMode}
                      options={['制表符\\t', '空格(2)', '空格(4)']}
                      onChange={(v) => update('editorTabMode', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="自动锁屏" desc="启动时询问密码，登录账号后启用">
                    <Toggle value={settings.autoLockScreen} onChange={(v) => update('autoLockScreen', v)} />
                  </SettingsRow>

                  <SettingsRow label="自动锁屏时间">
                    <SettingsSelect
                      value={settings.autoLockScreenTime}
                      options={['关闭', '1分钟', '5分钟', '10分钟', '30分钟']}
                      onChange={(v) => update('autoLockScreenTime', v)}
                    />
                  </SettingsRow>

                  <SettingsRow label="锁屏密码（登录账号后，可启用锁屏）">
                    <input
                      type="password"
                      className="settings-input"
                      value={settings.lockScreenPassword}
                      onChange={(e) => update('lockScreenPassword', e.target.value)}
                      disabled={!settings.autoLockScreen}
                    />
                  </SettingsRow>

                  <SettingsRow label="会话标签记忆" desc="启用后，自动会还原上次打开的标签">
                    <Toggle value={settings.sessionTabMemory} onChange={(v) => update('sessionTabMemory', v)} />
                  </SettingsRow>

                  <SettingsRow label="显示会员标志" desc="关闭后，付费用户将不会在顶部显示会员图标">
                    <Toggle value={settings.showVipBadge} onChange={(v) => update('showVipBadge', v)} />
                  </SettingsRow>
                </div>
              </div>
            )}

            {activeNav === 'ssh-sftp' && (
              <div className="settings-placeholder">SSH/SFTP 设置（开发中）</div>
            )}
            {activeNav === 'database' && (
              <div className="settings-placeholder">数据库设置（开发中）</div>
            )}
            {activeNav === 'ai' && (
              <div className="settings-placeholder">AI 账号设置（开发中）</div>
            )}
            {activeNav === 'shortcut-basic' && (
              <div className="settings-placeholder">基础快捷键设置（开发中）</div>
            )}
            {activeNav === 'shortcut-ssh' && (
              <div className="settings-placeholder">SSH/SFTP 快捷键设置（开发中）</div>
            )}
            {activeNav === 'docker' && (
              <div className="settings-placeholder">Docker 设置（开发中）</div>
            )}
            {activeNav === 'storage' && (
              <div className="settings-placeholder">储存仓库设置（开发中）</div>
            )}
            {activeNav === 'referral' && (
              <div className="settings-placeholder">推介有奖（开发中）</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <span className="settings-footer-hint">修改设置后如未生效，请重载页面或重启应用</span>
          <div className="settings-footer-actions">
            <button className="settings-btn-outline" onClick={handleReset}>恢复默认</button>
            <button
              className={`settings-btn-primary ${!dirty ? 'disabled' : ''}`}
              onClick={handleApply}
              disabled={!dirty}
            >
              应用 (Ctrl+S)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
