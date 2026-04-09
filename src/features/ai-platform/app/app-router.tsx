import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProvidersPage } from '../domains/providers/ProvidersPage';
import { SkillsPage } from '../domains/skills/SkillsPage';
import { AgentsPage } from '../domains/agents/AgentsPage';
import { UsagePage } from '../domains/usage/UsagePage';
import { ProxyPage } from '../domains/proxy/ProxyPage';
import { OpenClawPage } from '../domains/openclaw/OpenClawPage';
import { UniversalPage } from '../domains/universal/UniversalPage';
import { WorkspacePage } from '../domains/workspace/WorkspacePage';
import { SessionsPage } from '../domains/sessions/SessionsPage';
import { AuthPage } from '../domains/auth/AuthPage';
import { SettingsPage } from '../domains/settings/SettingsPage';

type RouteId =
  | 'providers'
  | 'skills'
  | 'agents'
  | 'usage'
  | 'proxy'
  | 'openclaw'
  | 'universal'
  | 'workspace'
  | 'sessions'
  | 'auth'
  | 'settings';

interface RouteItem {
  id: RouteId;
  title: string;
  description: string;
}

const routeDefinitions: RouteItem[] = [
  { id: 'providers', title: 'Providers', description: '多 app provider、模型、桥接与切换入口' },
  { id: 'skills', title: 'Skills', description: '仓库、安装、启停与导入' },
  { id: 'agents', title: 'Agents', description: 'Agent、分类、模型槽位与策略' },
  { id: 'usage', title: 'Usage', description: '趋势图、模型统计、计费配置与请求日志' },
  { id: 'proxy', title: 'Proxy', description: '反向代理、健康检查与故障转移控制台' },
  { id: 'openclaw', title: 'OpenClaw', description: 'OpenClaw 环境、工具、默认模型与健康状态' },
  { id: 'universal', title: 'Universal', description: '统一供应商与跨 app 同步视图' },
  { id: 'workspace', title: 'Workspace', description: 'Workspace 文件、日记忆与环境告警' },
  { id: 'sessions', title: 'Sessions', description: '会话记录、恢复命令与 deeplink 入口' },
  { id: 'auth', title: 'Auth', description: '鉴权中心、订阅、Copilot 与 coding plan' },
  { id: 'settings', title: 'Settings', description: 'AI 平台内部设置与基础设施配置' },
];

function renderRoute(route: RouteId) {
  switch (route) {
    case 'providers':
      return <ProvidersPage />;
    case 'skills':
      return <SkillsPage />;
    case 'agents':
      return <AgentsPage />;
    case 'usage':
      return <UsagePage />;
    case 'proxy':
      return <ProxyPage />;
    case 'openclaw':
      return <OpenClawPage />;
    case 'universal':
      return <UniversalPage />;
    case 'workspace':
      return <WorkspacePage />;
    case 'sessions':
      return <SessionsPage />;
    case 'auth':
      return <AuthPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

export function AiPlatformRouter() {
  const { t } = useTranslation(['ai', 'gwshell']);
  const [activeRoute, setActiveRoute] = useState<RouteId>('providers');

  return (
    <div className="ai-platform-layout">
      <aside className="ai-platform-sidebar ai-rounded-xl ai-border ai-border-border ai-bg-card ai-shadow-sm">
        <div className="ai-platform-sidebar-header">
          <div className="ai-text-xs ai-font-semibold ai-uppercase ai-tracking-[0.2em] ai-text-muted-foreground">
            {t('settings_title', { ns: 'gwshell', defaultValue: 'Settings' })}
          </div>
          <h2 className="ai-mt-2 ai-text-lg ai-font-semibold ai-text-card-foreground">AI Platform</h2>
          <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">
            单入口、多域、可切换的 cutover 应用壳。
          </p>
        </div>

        <nav className="ai-platform-nav">
          {routeDefinitions.map((route) => (
            <button
              key={route.id}
              type="button"
              className={`ai-platform-nav-item ${activeRoute === route.id ? 'active' : ''}`}
              onClick={() => setActiveRoute(route.id)}
            >
              <span className="ai-platform-nav-title">{route.title}</span>
              <span className="ai-platform-nav-desc">{route.description}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="ai-platform-main">{renderRoute(activeRoute)}</section>
    </div>
  );
}