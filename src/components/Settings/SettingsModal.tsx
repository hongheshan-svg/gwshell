import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, FolderOpen } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/* ---- Nav categories ---- */
const navCategories = [
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
      { id: 'shortcut-database', label: '数据库' },
    ],
  },
  { items: [{ id: 'docker', label: 'Docker' }] },
  { items: [{ id: 'storage', label: '储存仓库' }] },
  { items: [{ id: 'referral', label: '推介有奖' }] },
];

/* ---- Settings state ---- */
export interface AppSettings {
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
  // SSH/SFTP
  terminalFont: string;
  terminalFontSize: string;
  terminalHighlight: boolean;
  sshSftpPathLink: boolean;
  autoCopyOnSelect: boolean;
  terminalCmdHint: boolean;
  sshHistoryCmd: boolean;
  sshHistoryCmdStorage: string;
  sshHistoryCmdLoadCount: string;
  terminalStripeBackground: boolean;
  renderMode: boolean;
  autoReconnect: boolean;
  middleClickAction: string;
  rightClickAction: string;
  terminalSound: boolean;
  ctrlVPaste: boolean;
  terminalLineHeight: string;
  terminalLetterSpacing: string;
  terminalMaxScrollback: string;
  logDirectory: string;
  sftpDefaultEditor: string;
  sftpParentDirClick: boolean;
  sftpDefaultSavePath: string;
  sftpDoubleClickAction: string;
  // Database
  dbTableFont: string;
  dbAutoExpand: boolean;
  dbShowPrimaryKey: boolean;
  dbCalcTotalRows: boolean;
  dbCompositeHeader: boolean;
  dbLoadAllFields: boolean;
  dbTextAlign: string;
  dbRowsPerPage: string;
  dbDangerSqlConfirm: boolean;
  dbStopOnError: boolean;
  dbScrollMode: string;
  dbTabSwitchSpeed: string;
  redisMaxLoad: string;
  redisShowValue: boolean;
  redisGroupSeparator: string;
  // Storage
  storageAutoSync: boolean;
  storageSource: string;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  middleClickCloseTab: true,
  uiFont: 'JetBrainsMono, NotoSansSC',
  editorLineEnding: '(兼容) \\r\\n',
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
  terminalFont: 'JetBrainsMono, NotoSansSC',
  terminalFontSize: '12px',
  terminalHighlight: true,
  sshSftpPathLink: false,
  autoCopyOnSelect: true,
  terminalCmdHint: false,
  sshHistoryCmd: true,
  sshHistoryCmdStorage: '储存到本地',
  sshHistoryCmdLoadCount: '100',
  terminalStripeBackground: true,
  renderMode: true,
  autoReconnect: false,
  middleClickAction: '不执行',
  rightClickAction: '显示菜单',
  terminalSound: false,
  ctrlVPaste: false,
  terminalLineHeight: '1',
  terminalLetterSpacing: '0',
  terminalMaxScrollback: '1000',
  logDirectory: '',
  sftpDefaultEditor: '内置编辑器',
  sftpParentDirClick: false,
  sftpDefaultSavePath: '',
  sftpDoubleClickAction: '自动判断编辑/打开',
  dbTableFont: 'JetBrainsMono, NotoSansSC',
  dbAutoExpand: true,
  dbShowPrimaryKey: true,
  dbCalcTotalRows: false,
  dbCompositeHeader: false,
  dbLoadAllFields: false,
  dbTextAlign: '自动',
  dbRowsPerPage: '500',
  dbDangerSqlConfirm: true,
  dbStopOnError: false,
  dbScrollMode: '自然滚动',
  dbTabSwitchSpeed: '1',
  redisMaxLoad: '10000',
  redisShowValue: false,
  redisGroupSeparator: ':',
  storageAutoSync: true,
  storageSource: '关闭同步',
};

/* ---- Shortcut data ---- */
interface ShortcutItem { label: string; keys: string }
const shortcutsBasicLeft: ShortcutItem[] = [
  { label: '保存', keys: 'Ctrl S' },
  { label: '查找', keys: 'Ctrl F' },
  { label: '复制', keys: 'Ctrl C' },
  { label: '粘贴', keys: 'Ctrl V' },
  { label: '剪切', keys: 'Ctrl X' },
  { label: '删除', keys: 'Backspace' },
  { label: '重命名', keys: 'F2' },
];
const shortcutsBasicRight: ShortcutItem[] = [
  { label: '刷新', keys: 'F5' },
  { label: '进入', keys: 'Enter' },
  { label: '撤销', keys: 'Ctrl Z' },
  { label: '重做', keys: 'Ctrl Y' },
  { label: '全选', keys: 'Ctrl A' },
  { label: '切换焦点', keys: 'Tab' },
];
const shortcutsOtherLeft: ShortcutItem[] = [
  { label: '打开 Agent', keys: 'Ctrl L' },
  { label: '全局搜索', keys: 'Ctrl Shift F' },
  { label: '唤起历史记录', keys: 'Ctrl E' },
  { label: '格式化', keys: 'Shift Alt F' },
  { label: '压缩', keys: 'Shift Alt C' },
];
const shortcutsOtherRight: ShortcutItem[] = [
  { label: '向左', keys: '←' },
  { label: '向右', keys: '→' },
  { label: '向上', keys: '↑' },
  { label: '向下', keys: '↓' },
  { label: '旋转至自定义行', keys: 'Ctrl Shift →' },
];
const shortcutsSshLeft: ShortcutItem[] = [
  { label: '终端文本复制', keys: 'Ctrl Shift C' },
  { label: '清屏', keys: 'Ctrl Shift L' },
  { label: '上传', keys: 'Ctrl Shift U' },
  { label: '下载', keys: 'Ctrl Shift D' },
  { label: '复制文件路径', keys: 'Ctrl Alt C' },
  { label: '创建新文件', keys: 'Ctrl Alt N' },
];
const shortcutsSshRight: ShortcutItem[] = [
  { label: '终端文本粘贴', keys: 'Ctrl Shift V' },
  { label: '重连', keys: 'Ctrl Shift R' },
  { label: '编辑文件', keys: 'Ctrl Alt E' },
  { label: '修改文件权限', keys: 'Ctrl Alt M' },
  { label: '切换广播输入开关', keys: 'Ctrl Shift B' },
];
const shortcutsDbLeft: ShortcutItem[] = [
  { label: '新查询', keys: 'Ctrl Shift Q' },
  { label: '新建表', keys: 'Ctrl Shift T' },
  { label: '切换到表列表', keys: 'Ctrl Shift 1' },
  { label: '切换到查询列表', keys: 'Ctrl Shift 3' },
  { label: '切换到表结构编辑器', keys: 'Ctrl Shift S' },
  { label: '运行SQL', keys: 'Ctrl Enter' },
  { label: '停止运行', keys: 'Ctrl F2' },
  { label: '显示表DDL', keys: 'None' },
];
const shortcutsDbRight: ShortcutItem[] = [
  { label: '新建视图', keys: 'Ctrl Shift V' },
  { label: '开始事务', keys: 'None' },
  { label: '回滚事务', keys: 'None' },
  { label: '提交事务', keys: 'None' },
  { label: '切换到表数据', keys: 'Ctrl Shift 0' },
  { label: '打开数据过滤器', keys: 'None' },
  { label: '插入数据', keys: 'Ctrl Insert' },
  { label: '克隆数据', keys: 'Ctrl Shift C' },
  { label: '设置值为空', keys: 'Alt Delete' },
];
const shortcutsDockerLeft: ShortcutItem[] = [
  { label: '切换到容器列表', keys: 'Ctrl Shift 1' },
  { label: '切换到镜像列表', keys: 'Ctrl Shift 2' },
  { label: '跳转容器详情', keys: 'Ctrl Shift C' },
  { label: '跳转容器终端', keys: 'Ctrl Shift T' },
  { label: '跳转容器日志', keys: 'Ctrl Shift L' },
  { label: '跳转容器镜像', keys: 'Ctrl Shift I' },
  { label: '镜像Pull', keys: 'Ctrl Shift P' },
];
const shortcutsDockerRight: ShortcutItem[] = [
  { label: '切换到网络列表', keys: 'Ctrl Shift 3' },
  { label: '切换到卷列表', keys: 'Ctrl Shift 4' },
  { label: '启动容器', keys: 'Ctrl Shift 0' },
  { label: '停止容器', keys: 'Ctrl Shift W' },
  { label: '重启容器', keys: 'Ctrl Shift R' },
  { label: '暂停容器', keys: 'Ctrl Shift E' },
];
const aiProviders = [
  { id: 'custom', name: '自定义 API', count: 0, desc: '自定义模型服务，\n支持 OpenAI /\nResponses /\nClaude /\nGemini / Azure\nGPT / Ollama。' },
  { id: 'openai', name: 'OpenAI', count: 0 },
  { id: 'openrouter', name: 'OpenRouter', count: 0 },
  { id: 'claude', name: 'Claude', count: 0 },
];

/* ---- Sub-components ---- */
const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <button className={`settings-toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} type="button">
    <span className="settings-toggle-knob" />
  </button>
);

const Sel: React.FC<{ value: string; options: string[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const NumInput: React.FC<{ value: string; onChange: (v: string) => void; prefix?: string; width?: number }> = ({ value, onChange, prefix, width }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    {prefix && <span className="settings-desc">{prefix}</span>}
    <input className="settings-input" style={{ width: width || 70 }} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div className="settings-row">
    <div className="settings-row-left">
      <span className="settings-label">{label}</span>
      {desc && <span className="settings-desc">{desc}</span>}
    </div>
    <div className="settings-row-right">{children}</div>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="settings-section-title">{children}</div>
);

const ShortcutTable: React.FC<{ left: ShortcutItem[]; right: ShortcutItem[] }> = ({ left, right }) => (
  <div className="settings-columns">
    <div className="settings-col">
      {left.map((s) => (
        <div key={s.label} className="shortcut-row">
          <span className="shortcut-label">{s.label}</span>
          <span className="shortcut-keys">{s.keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
        </div>
      ))}
    </div>
    <div className="settings-col">
      {right.map((s) => (
        <div key={s.label} className="shortcut-row">
          <span className="shortcut-label">{s.label}</span>
          <span className="shortcut-keys">{s.keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
        </div>
      ))}
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

  const u = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleApply = () => {
    if (settings.theme !== theme) toggleTheme();
    setDirty(false);
  };

  const handleReset = () => { setSettings({ ...defaultSettings, theme }); setDirty(true); };

  if (!showSettings) return null;
  const handleClose = () => setShowSettings(false);
  const fonts = ['JetBrainsMono, NotoSansSC', 'Consolas', 'Cascadia Code', 'Fira Code', 'monospace'];

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-left"><span className="settings-brand">GWShell</span></div>
          <h2>设置</h2>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        <div className="settings-body">
          {/* Nav */}
          <div className="settings-nav">
            {navCategories.map((cat, i) => (
              <div key={i} className="settings-nav-group">
                {cat.title && <div className="settings-nav-title">{cat.title}</div>}
                {cat.items.map((item) => (
                  <button key={item.id} className={`settings-nav-item ${activeNav === item.id ? 'active' : ''}`}
                    onClick={() => setActiveNav(item.id)}>{item.label}</button>
                ))}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">

            {/* ===== 基础 ===== */}
            {activeNav === 'basic' && (
              <div className="settings-columns">
                <div className="settings-col">
                  <SectionTitle>基本</SectionTitle>
                  <Row label="主题"><Sel value={settings.theme === 'dark' ? 'Dark' : 'Light'} options={['Dark', 'Light']} onChange={(v) => u('theme', v === 'Dark' ? 'dark' : 'light')} /></Row>
                  <Row label="鼠标中键关闭选项卡"><Toggle value={settings.middleClickCloseTab} onChange={(v) => u('middleClickCloseTab', v)} /></Row>
                  <Row label="UI字体"><Sel value={settings.uiFont} options={fonts} onChange={(v) => u('uiFont', v)} /></Row>
                  <Row label="编辑器换行符"><Sel value={settings.editorLineEnding} options={['(兼容) \\r\\n', '\\n', '\\r']} onChange={(v) => u('editorLineEnding', v)} /></Row>
                  <Row label="是否开启动画"><Toggle value={settings.enableAnimation} onChange={(v) => u('enableAnimation', v)} /></Row>
                  <Row label="显示右侧实时信息" desc="关闭后将隐藏服务器实时指标"><Toggle value={settings.showRealtimeInfo} onChange={(v) => u('showRealtimeInfo', v)} /></Row>
                  <Row label="Tab栏关闭按钮位置"><Sel value={settings.tabCloseButtonPos} options={['靠左', '靠右']} onChange={(v) => u('tabCloseButtonPos', v)} /></Row>
                  <Row label="连体字效果"><Toggle value={settings.ligatures} onChange={(v) => u('ligatures', v)} /></Row>
                  <Row label="鼠标滚轮缩放"><Toggle value={settings.mouseWheelZoom} onChange={(v) => u('mouseWheelZoom', v)} /></Row>
                  <Row label="标签关闭确认" desc="关闭后SSH、终端等标签关闭时不显示确认提示窗"><Toggle value={settings.tabCloseConfirm} onChange={(v) => u('tabCloseConfirm', v)} /></Row>
                  <Row label="标签闪烁提醒" desc="非当前标签页有新活动时，将触发闪烁提醒"><Toggle value={settings.tabFlashAlert} onChange={(v) => u('tabFlashAlert', v)} /></Row>
                  <Row label="多行显示标签卡" desc="标签卡过多时以多行方式显示，而不是横向滚动"><Toggle value={settings.multiLineTab} onChange={(v) => u('multiLineTab', v)} /></Row>
                </div>
                <div className="settings-col">
                  <SectionTitle>&nbsp;</SectionTitle>
                  <Row label="语言"><Sel value={settings.language} options={['简体中文', 'English', '繁體中文', '日本語']} onChange={(v) => u('language', v)} /></Row>
                  <Row label="更新通道" desc="修改后需重启生效，通道之间用户不共享"><Sel value={settings.updateChannel} options={['稳定通道', '测试通道', '开发通道']} onChange={(v) => u('updateChannel', v)} /></Row>
                  <Row label="编辑器字体"><Sel value={settings.editorFont} options={fonts} onChange={(v) => u('editorFont', v)} /></Row>
                  <Row label="缩放比例"><Sel value={settings.zoomLevel} options={['80%', '90%', '100%', '110%', '120%', '150%']} onChange={(v) => u('zoomLevel', v)} /></Row>
                  <Row label="编辑器字号"><Sel value={settings.editorFontSize} options={['12px', '13px', '14px', '15px', '16px', '18px', '20px']} onChange={(v) => u('editorFontSize', v)} /></Row>
                  <Row label="编辑器自动换行"><Toggle value={settings.editorAutoWrap} onChange={(v) => u('editorAutoWrap', v)} /></Row>
                  <Row label="编辑器Tab键模式"><Sel value={settings.editorTabMode} options={['制表符\\t', '空格(2)', '空格(4)']} onChange={(v) => u('editorTabMode', v)} /></Row>
                  <Row label="自动锁屏" desc="启动时询问密码，登录账号后启用"><Toggle value={settings.autoLockScreen} onChange={(v) => u('autoLockScreen', v)} /></Row>
                  <Row label="自动锁屏时间"><Sel value={settings.autoLockScreenTime} options={['关闭', '1分钟', '5分钟', '10分钟', '30分钟']} onChange={(v) => u('autoLockScreenTime', v)} /></Row>
                  <Row label="锁屏密码（登录账号后，可启用锁屏）"><input type="password" className="settings-input" value={settings.lockScreenPassword} onChange={(e) => u('lockScreenPassword', e.target.value)} disabled={!settings.autoLockScreen} /></Row>
                  <Row label="会话标签记忆" desc="启用后，自动会还原上次打开的标签"><Toggle value={settings.sessionTabMemory} onChange={(v) => u('sessionTabMemory', v)} /></Row>
                  <Row label="显示会员标志" desc="关闭后，付费用户将不会在顶部显示会员图标"><Toggle value={settings.showVipBadge} onChange={(v) => u('showVipBadge', v)} /></Row>
                </div>
              </div>
            )}

            {/* ===== SSH/SFTP ===== */}
            {activeNav === 'ssh-sftp' && (
              <>
                <SectionTitle>SSH</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label="终端字体" desc="请选择等宽字体，否则排版显示异常"><Sel value={settings.terminalFont} options={fonts} onChange={(v) => u('terminalFont', v)} /></Row>
                    <Row label="终端高亮增强"><Toggle value={settings.terminalHighlight} onChange={(v) => u('terminalHighlight', v)} /></Row>
                    <Row label="SSH/SFTP路径联动"><Toggle value={settings.sshSftpPathLink} onChange={(v) => u('sshSftpPathLink', v)} /></Row>
                    <Row label="鼠标选中自动复制"><Toggle value={settings.autoCopyOnSelect} onChange={(v) => u('autoCopyOnSelect', v)} /></Row>
                    <Row label="终端命令输入提示"><Toggle value={settings.terminalCmdHint} onChange={(v) => u('terminalCmdHint', v)} /></Row>
                    <Row label="SSH历史命令"><Toggle value={settings.sshHistoryCmd} onChange={(v) => u('sshHistoryCmd', v)} /></Row>
                    <Row label="SSH历史命令-储存方式"><Sel value={settings.sshHistoryCmdStorage} options={['储存到本地', '储存到云端']} onChange={(v) => u('sshHistoryCmdStorage', v)} /></Row>
                    <Row label="SSH历史命令-输入提示加载数量"><NumInput value={settings.sshHistoryCmdLoadCount} onChange={(v) => u('sshHistoryCmdLoadCount', v)} /></Row>
                    <Row label="终端护眼模式-条纹背景"><Toggle value={settings.terminalStripeBackground} onChange={(v) => u('terminalStripeBackground', v)} /></Row>
                    <Row label="渲染模式（高性能模式）" desc="高性能模式能够更快进行终端渲染"><Toggle value={settings.renderMode} onChange={(v) => u('renderMode', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label="终端字号"><Sel value={settings.terminalFontSize} options={['10px', '11px', '12px', '13px', '14px', '16px', '18px']} onChange={(v) => u('terminalFontSize', v)} /></Row>
                    <Row label="连接断开自动重连"><Toggle value={settings.autoReconnect} onChange={(v) => u('autoReconnect', v)} /></Row>
                    <Row label="鼠标中键执行"><Sel value={settings.middleClickAction} options={['不执行', '粘贴']} onChange={(v) => u('middleClickAction', v)} /></Row>
                    <Row label="鼠标右键执行"><Sel value={settings.rightClickAction} options={['显示菜单', '粘贴']} onChange={(v) => u('rightClickAction', v)} /></Row>
                    <Row label="终端声音"><Toggle value={settings.terminalSound} onChange={(v) => u('terminalSound', v)} /></Row>
                    <Row label="Ctrl+V粘贴" desc="将忽略Ctrl+V作为粘贴快捷键"><Toggle value={settings.ctrlVPaste} onChange={(v) => u('ctrlVPaste', v)} /></Row>
                    <Row label="终端行高"><NumInput value={settings.terminalLineHeight} onChange={(v) => u('terminalLineHeight', v)} prefix="基准值为1" /></Row>
                    <Row label="终端间距"><NumInput value={settings.terminalLetterSpacing} onChange={(v) => u('terminalLetterSpacing', v)} prefix="默认为0" /></Row>
                    <Row label="终端最大缓存行数"><NumInput value={settings.terminalMaxScrollback} onChange={(v) => u('terminalMaxScrollback', v)} /></Row>
                    <Row label="日志储存目录">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="settings-icon-btn"><FolderOpen size={14} /></button>
                        <input className="settings-input" style={{ width: 140 }} placeholder="不填则关闭日志录制" value={settings.logDirectory} onChange={(e) => u('logDirectory', e.target.value)} />
                      </div>
                    </Row>
                  </div>
                </div>
                <SectionTitle>SFTP</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label="默认编辑器"><Sel value={settings.sftpDefaultEditor} options={['内置编辑器', 'VS Code', 'Sublime Text']} onChange={(v) => u('sftpDefaultEditor', v)} /></Row>
                    <Row label="上级目录(..)单击打开"><Toggle value={settings.sftpParentDirClick} onChange={(v) => u('sftpParentDirClick', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label="默认保存路径">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button className="settings-icon-btn"><FolderOpen size={14} /></button>
                        <input className="settings-input" style={{ width: 140 }} placeholder="不填则使用默认路径" value={settings.sftpDefaultSavePath} onChange={(e) => u('sftpDefaultSavePath', e.target.value)} />
                      </div>
                    </Row>
                    <Row label="双击打开文件逻辑"><Sel value={settings.sftpDoubleClickAction} options={['自动判断编辑/打开', '始终编辑', '始终下载']} onChange={(v) => u('sftpDoubleClickAction', v)} /></Row>
                  </div>
                </div>
              </>
            )}

            {/* ===== 数据库 ===== */}
            {activeNav === 'database' && (
              <>
                <SectionTitle>数据库</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label="表格字体"><Sel value={settings.dbTableFont} options={fonts} onChange={(v) => u('dbTableFont', v)} /></Row>
                    <Row label="打开连接时自动展开"><Toggle value={settings.dbAutoExpand} onChange={(v) => u('dbAutoExpand', v)} /></Row>
                    <Row label="固定显示表格主键列"><Toggle value={settings.dbShowPrimaryKey} onChange={(v) => u('dbShowPrimaryKey', v)} /></Row>
                    <Row label="计算表数据总行数" desc="开启后将自动获取总行数/总页数"><Toggle value={settings.dbCalcTotalRows} onChange={(v) => u('dbCalcTotalRows', v)} /></Row>
                    <Row label="复合数据表头" desc="开启后将在数据表头固定显示类型·注释"><Toggle value={settings.dbCompositeHeader} onChange={(v) => u('dbCompositeHeader', v)} /></Row>
                    <Row label="加载所有库字段信息" desc="开启后SQL编辑器能够跨数据库提示"><Toggle value={settings.dbLoadAllFields} onChange={(v) => u('dbLoadAllFields', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label="表格文本对齐方式"><Sel value={settings.dbTextAlign} options={['自动', '左对齐', '居中', '右对齐']} onChange={(v) => u('dbTextAlign', v)} /></Row>
                    <Row label="表格每页显示行数"><NumInput value={settings.dbRowsPerPage} onChange={(v) => u('dbRowsPerPage', v)} /></Row>
                    <Row label="危险SQL执行二次确认"><Toggle value={settings.dbDangerSqlConfirm} onChange={(v) => u('dbDangerSqlConfirm', v)} /></Row>
                    <Row label="SQL编辑器执行失败时停止"><Toggle value={settings.dbStopOnError} onChange={(v) => u('dbStopOnError', v)} /></Row>
                    <Row label="表格滚动方式"><Sel value={settings.dbScrollMode} options={['自然滚动', '经典滚动']} onChange={(v) => u('dbScrollMode', v)} /></Row>
                    <Row label="表格源标签切换速度"><NumInput value={settings.dbTabSwitchSpeed} onChange={(v) => u('dbTabSwitchSpeed', v)} /></Row>
                  </div>
                </div>
                <SectionTitle>Redis</SectionTitle>
                <div className="settings-columns">
                  <div className="settings-col">
                    <Row label="键列表-最大加载数据量"><NumInput value={settings.redisMaxLoad} onChange={(v) => u('redisMaxLoad', v)} /></Row>
                    <Row label="键列表-显示值" desc="低带宽环境，关闭值加载后可有效提升加载速度"><Toggle value={settings.redisShowValue} onChange={(v) => u('redisShowValue', v)} /></Row>
                  </div>
                  <div className="settings-col">
                    <Row label="键列表-分组分隔符"><NumInput value={settings.redisGroupSeparator} onChange={(v) => u('redisGroupSeparator', v)} width={50} /></Row>
                  </div>
                </div>
              </>
            )}

            {/* ===== AI ===== */}
            {activeNav === 'ai' && (
              <div className="settings-columns" style={{ gap: 24 }}>
                <div className="settings-col" style={{ maxWidth: 260 }}>
                  <SectionTitle>供应商</SectionTitle>
                  <p className="settings-desc" style={{ marginBottom: 10 }}>固定模板列表，能供应商维护多个配置实例。</p>
                  <div className="ai-search-box">
                    <input placeholder="筛选供应商 ..." />
                  </div>
                  <div className="ai-provider-list">
                    {aiProviders.map((p) => (
                      <div key={p.id} className="ai-provider-card">
                        <div className="ai-provider-name">
                          <span>{p.name}</span>
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Plus size={14} />
                            <span className="ai-provider-count">{p.count}</span>
                          </span>
                        </div>
                        {p.desc && <p className="ai-provider-desc">{p.desc}</p>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="settings-col" style={{ flex: 1 }}>
                  <SectionTitle>配置列表</SectionTitle>
                  <p className="settings-desc" style={{ marginBottom: 10 }}>全局显示所有配置实例；每个配置下单独维护已添加模型。</p>
                  <div className="ai-config-empty">
                    <h3>当前还没有配置</h3>
                    <p>先在左侧选择一个供应商，再点击供应商卡片右上角新增配置。</p>
                  </div>
                </div>
              </div>
            )}

            {/* ===== 账号 ===== */}
            {activeNav === 'ai-account' && null}

            {/* ===== 快捷键-基础 ===== */}
            {activeNav === 'shortcut-basic' && (
              <>
                <SectionTitle>基础</SectionTitle>
                <ShortcutTable left={shortcutsBasicLeft} right={shortcutsBasicRight} />
                <SectionTitle>其他</SectionTitle>
                <ShortcutTable left={shortcutsOtherLeft} right={shortcutsOtherRight} />
              </>
            )}

            {/* ===== 快捷键-SSH/SFTP ===== */}
            {activeNav === 'shortcut-ssh' && (
              <>
                <SectionTitle>SSH/SFTP</SectionTitle>
                <ShortcutTable left={shortcutsSshLeft} right={shortcutsSshRight} />
              </>
            )}

            {/* ===== 快捷键-数据库 ===== */}
            {activeNav === 'shortcut-database' && (
              <>
                <SectionTitle>数据库</SectionTitle>
                <ShortcutTable left={shortcutsDbLeft} right={shortcutsDbRight} />
              </>
            )}

            {/* ===== Docker (快捷键) ===== */}
            {activeNav === 'docker' && (
              <>
                <SectionTitle>Docker</SectionTitle>
                <ShortcutTable left={shortcutsDockerLeft} right={shortcutsDockerRight} />
              </>
            )}

            {/* ===== 储存仓库 ===== */}
            {activeNav === 'storage' && (
              <>
                <SectionTitle>资产同步</SectionTitle>
                <div className="settings-col" style={{ maxWidth: 700 }}>
                  <div className="storage-row">
                    <span className="settings-label">本地数据</span>
                    <span className="settings-desc" style={{ flex: 1 }}>注意：此操作将导致本地连接/配置完全清空！</span>
                    <button className="settings-btn-danger">清除本地数据</button>
                  </div>
                  <div className="storage-row">
                    <span className="settings-label">本地仓库资产备份/恢复</span>
                    <span className="settings-desc" style={{ flex: 1 }}>如果出现资产丢失可以使用此按钮进行恢复！</span>
                    <button className="settings-btn-outline">恢复备份</button>
                  </div>
                  <div className="storage-row">
                    <span className="settings-label">本地仓库资产导入/导出</span>
                    <span className="settings-desc" style={{ flex: 1 }}>注意：导入资产时将以配置内容优先进行覆盖！</span>
                    <button className="settings-btn-outline" style={{ marginRight: 6 }}>导入</button>
                    <button className="settings-btn-outline">导出</button>
                  </div>
                  <Row label="自动同步" desc="新建资产时将自动进行同步"><Toggle value={settings.storageAutoSync} onChange={(v) => u('storageAutoSync', v)} /></Row>
                  <Row label="仓库源"><Sel value={settings.storageSource} options={['关闭同步', 'GitHub Gist', 'Gitee Gist', 'WebDAV']} onChange={(v) => u('storageSource', v)} /></Row>
                </div>
              </>
            )}

            {/* ===== 推介有奖 ===== */}
            {activeNav === 'referral' && (
              <div className="settings-placeholder">
                <div style={{ textAlign: 'center' }}>
                  <h3 style={{ marginBottom: 8 }}>推介有奖</h3>
                  <p>邀请好友使用 GWShell，双方均可获得奖励！</p>
                  <p className="settings-desc" style={{ marginTop: 12 }}>功能开发中，敬请期待...</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          {activeNav === 'storage' ? (
            <span className="settings-footer-hint">此功能仅专业版可用，修改设置后如未生效，请重载页面或重启应用</span>
          ) : activeNav === 'ai' ? (
            <span className="settings-footer-hint">供应商模板固定在代码中；页面只保存 provider 配置实例与其下的模型列表。</span>
          ) : (
            <span className="settings-footer-hint">修改设置后如未生效，请重载页面或重启应用</span>
          )}
          <div className="settings-footer-actions">
            <button className="settings-btn-outline" onClick={handleReset}>恢复默认</button>
            <button className={`settings-btn-primary ${!dirty ? 'disabled' : ''}`} onClick={handleApply} disabled={!dirty}>
              应用 (Ctrl+S)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
