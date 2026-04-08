import { useTranslation } from 'react-i18next';
import { AiPlatformRouter } from './app-router';
import { useAiPlatformHealth } from '../infra/query/useAiPlatformHealth';

export function AiPlatformShell() {
  const { t } = useTranslation(['ai', 'gwshell']);
  const { data: health, isLoading } = useAiPlatformHealth();

  return (
    <div className="ai-grid ai-gap-6 ai-p-6">
      <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-6 ai-shadow-sm">
        <div className="ai-flex ai-items-center ai-justify-between ai-gap-4">
          <div>
            <p className="ai-text-xs ai-font-semibold ai-uppercase ai-tracking-[0.2em] ai-text-muted-foreground">
              AI Platform
            </p>
            <h2 className="ai-mt-2 ai-text-2xl ai-font-semibold ai-text-card-foreground">
              {t('app.title', { ns: 'ai', defaultValue: 'CC Switch' })}
            </h2>
            <p className="ai-mt-2 ai-max-w-2xl ai-text-sm ai-leading-6 ai-text-muted-foreground">
              新 AI 平台入口已经从兼容式骨架切到 feature-first 根结构。后续 Providers、MCP、Prompts、Skills、Usage、Proxy 等域都会在这个壳层下扩展，而不是继续堆叠到旧 Settings 组件里。
            </p>
          </div>
          <div className="ai-min-w-[220px] ai-rounded-lg ai-border ai-border-border ai-bg-background ai-p-4">
            <div className="ai-text-xs ai-uppercase ai-tracking-[0.18em] ai-text-muted-foreground">Status</div>
            <div className="ai-mt-2 ai-text-lg ai-font-medium">
              {isLoading ? 'Checking bridge...' : health?.status === 'ok' ? 'Cutover Root Active' : 'Bridge Unavailable'}
            </div>
            <div className="ai-mt-1 ai-text-sm ai-text-muted-foreground">
              {health
                ? `${health.frontendRoot} -> ${health.backendRoot}`
                : 'gwshell / ai 双 namespace 已接入新根'}
            </div>
            {health && (
              <div className="ai-mt-2 ai-text-xs ai-text-muted-foreground">Mode: {health.bridgeMode}</div>
            )}
          </div>
        </div>
      </section>

      <section className="ai-grid ai-gap-4 md:ai-grid-cols-3">
        {[
          ['Providers', '下一步承接多 app provider、磁盘桥接、故障转移与健康状态。'],
          ['System Domains', '后续会纳入 MCP、Prompts、Skills、Agents、Usage、Workspace。'],
          ['Backend Cutover', 'Rust 侧会迁入 ai_platform 命名空间，旧 ai_config / mcp_config 只作为导入源。'],
        ].map(([title, body]) => (
          <article key={title} className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-5 ai-shadow-sm">
            <h3 className="ai-text-base ai-font-semibold ai-text-card-foreground">{title}</h3>
            <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">{body}</p>
          </article>
        ))}
      </section>

      <section className="ai-rounded-xl ai-border ai-border-border ai-bg-card ai-p-5 ai-shadow-sm">
        <h3 className="ai-text-base ai-font-semibold ai-text-card-foreground">Language Bridge</h3>
        <p className="ai-mt-2 ai-text-sm ai-leading-6 ai-text-muted-foreground">
          当前 gwshell 文案仍通过 {t('settings_title', { ns: 'gwshell', defaultValue: 'Settings' })} 等 key 由统一 i18next 实例提供，新壳层不会再创建第二套语言系统。
        </p>
      </section>

      <AiPlatformRouter />
    </div>
  );
}