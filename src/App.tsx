import { Suspense, lazy, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { TitleBar } from './components/TitleBar/TitleBar';
import { SidebarFooter } from './components/Sidebar/SidebarFooter';
import { SessionPanel } from './components/Sidebar/SessionPanel';
import { SnippetPanel } from './components/Sidebar/SnippetPanel';
import { AssetTable } from './components/AssetTable/AssetTable';
import { StatusBar } from './components/StatusBar/StatusBar';
import { UnlockScreen } from './components/UnlockScreen';
import { ToastProvider } from './components/Toast/ToastProvider';
import { ConfirmDialog } from './components/ConfirmDialog/ConfirmDialog';
import { DockerContainerPicker } from './components/Terminal/DockerContainerPicker';
import {
  dispatchTypedEvent,
  type DockerPickPayload,
  type DockerCancelPayload,
} from './lib/ipcEvents';
import { useAppStore } from './stores/appStore';
import { useSettingsEffects } from './hooks/useSettingsEffects';
import { useAppBoot } from './hooks/useAppBoot';
import i18n from './i18n';
import './styles/theme.css';
import './styles/global.css';

// Heavy / interaction-only chunks: deferred until the user actually needs them.
const TerminalContainer = lazy(() =>
  import('./components/Terminal/TerminalContainer').then((m) => ({ default: m.TerminalContainer })),
);
const SftpPanel = lazy(() =>
  import('./components/SftpPanel/SftpPanel').then((m) => ({ default: m.SftpPanel })),
);
const TerminalSearchBar = lazy(() =>
  import('./components/Terminal/TerminalSearchBar').then((m) => ({ default: m.TerminalSearchBar })),
);
const NewSessionModal = lazy(() =>
  import('./components/Modals/NewSessionModal').then((m) => ({ default: m.NewSessionModal })),
);
const QuickConnectModal = lazy(() =>
  import('./components/Modals/QuickConnectModal').then((m) => ({ default: m.QuickConnectModal })),
);
const DockerModal = lazy(() =>
  import('./components/Modals/DockerModal').then((m) => ({ default: m.DockerModal })),
);
const LocalTerminalModal = lazy(() =>
  import('./components/Modals/LocalTerminalModal').then((m) => ({ default: m.LocalTerminalModal })),
);
const SerialPortModal = lazy(() =>
  import('./components/Modals/SerialPortModal').then((m) => ({ default: m.SerialPortModal })),
);
const SettingsModal = lazy(() =>
  import('./components/Settings/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const AppMenu = lazy(() =>
  import('./components/AppMenu/AppMenu').then((m) => ({ default: m.AppMenu })),
);
const UpdateChecker = lazy(() =>
  import('./components/UpdateChecker/UpdateChecker').then((m) => ({ default: m.UpdateChecker })),
);
const SecurityNotice = lazy(() =>
  import('./components/SecurityNotice/SecurityNotice').then((m) => ({ default: m.SecurityNotice })),
);
const ServerPanel = lazy(() =>
  import('./components/ServerPanel').then((m) => ({ default: m.ServerPanel })),
);
const AgentPanel = lazy(() =>
  import('./components/Agent').then((m) => ({ default: m.AgentPanel })),
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const GroupDefaultsModal = lazy(() =>
  import('./components/Modals/GroupDefaultsModal').then((m) => ({ default: m.GroupDefaultsModal })),
);

function App() {
  useSettingsEffects();
  useAppBoot();

  const {
    tabs,
    activeTabId,
    sftpPanelOpen,
    sessions,
    showNewSession,
    showQuickConnect,
    showDockerModal,
    showLocalTerminalModal,
    showSerialModal,
    showSettings,
    showAppMenu,
    showCommandPalette,
    showTerminalSearch,
    groupDefaultsTarget,
    dockerPicker,
    setDockerPicker,
    vaultLocked,
    mainView,
    activeNavItem,
    sidebarCollapsed,
    agentPanelOpen,
  } = useAppStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      sftpPanelOpen: s.sftpPanelOpen,
      sessions: s.sessions,
      showNewSession: s.showNewSession,
      showQuickConnect: s.showQuickConnect,
      showDockerModal: s.showDockerModal,
      showLocalTerminalModal: s.showLocalTerminalModal,
      showSerialModal: s.showSerialModal,
      showSettings: s.showSettings,
      showAppMenu: s.showAppMenu,
      showCommandPalette: s.showCommandPalette,
      showTerminalSearch: s.showTerminalSearch,
      groupDefaultsTarget: s.groupDefaultsTarget,
      dockerPicker: s.dockerPicker,
      setDockerPicker: s.setDockerPicker,
      vaultLocked: s.vaultLocked,
      mainView: s.mainView,
      activeNavItem: s.activeNavItem,
      sidebarCollapsed: s.sidebarCollapsed,
      agentPanelOpen: s.agentPanelOpen,
    })),
  );

  // Keep TerminalContainer mounted once any terminal tab exists (hidden via CSS
  // while viewing the Asset List) so live SSH/PTY/Serial tabs never tear down
  // their data/exit event listeners and drop output or logs in the background.
  const hasTerminalTabs = tabs.some((t) => t.type !== 'asset-list');
  const showAssetTable =
    activeTabId === 'asset-list' || mainView === 'asset-list' || !hasTerminalTabs;
  const needTerminals = hasTerminalTabs;
  const [agentPanelMounted, setAgentPanelMounted] = useState(false);

  useEffect(() => {
    if (agentPanelOpen && !agentPanelMounted) {
      setAgentPanelMounted(true);
    }
  }, [agentPanelOpen, agentPanelMounted]);

  return (
    <I18nextProvider i18n={i18n}>
      {vaultLocked && <UnlockScreen />}
      <div className="app-root">
        <TitleBar />
        <div className={`app-layout${sidebarCollapsed ? ' app-layout--sidebar-collapsed' : ''}`}>
          {!sidebarCollapsed && (
            <div className="sidebar-column">
              {activeNavItem === 'snippets' ? <SnippetPanel /> : <SessionPanel />}
              <SidebarFooter />
            </div>
          )}
          <div className="main-content">
            <div className="terminal-sftp-wrapper">
              {showAssetTable && (
                <div className="terminal-container">
                  <AssetTable />
                </div>
              )}
              {needTerminals && (
                <div
                  style={{
                    display: showAssetTable ? 'none' : 'flex',
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                  }}
                >
                  <Suspense fallback={null}>
                    <TerminalContainer />
                  </Suspense>
                </div>
              )}
              {!showAssetTable && needTerminals && showTerminalSearch && (
                <Suspense fallback={null}>
                  <TerminalSearchBar />
                </Suspense>
              )}
              {sftpPanelOpen &&
                (() => {
                  const activeTab = tabs.find((t) => t.id === activeTabId);
                  if (activeTab?.type !== 'ssh') return null;
                  const sess = sessions.find((s) => s.id === activeTab.sessionId);
                  return (
                    <Suspense fallback={null}>
                      <SftpPanel
                        key={activeTab.sessionId}
                        sessionId={activeTab.sessionId}
                        username={sess?.username}
                        connected={activeTab.connected}
                      />
                    </Suspense>
                  );
                })()}
              {agentPanelMounted && (
                <Suspense fallback={null}>
                  <AgentPanel />
                </Suspense>
              )}
            </div>
            <StatusBar />
          </div>
        </div>
        <Suspense fallback={null}>
          {showNewSession && <NewSessionModal />}
          {showQuickConnect && <QuickConnectModal />}
          {showDockerModal && <DockerModal />}
          {showLocalTerminalModal && <LocalTerminalModal />}
          {showSerialModal && <SerialPortModal />}
          {showSettings && <SettingsModal />}
          {showAppMenu && <AppMenu />}
          {showCommandPalette && <CommandPalette />}
          {groupDefaultsTarget !== null && <GroupDefaultsModal />}
          <UpdateChecker />
          <SecurityNotice />
          <ServerPanel />
        </Suspense>
        {dockerPicker && (
          <DockerContainerPicker
            containers={dockerPicker.containers}
            onPick={(id) => {
              dispatchTypedEvent<DockerPickPayload>('gwshell:docker-pick', {
                tabId: dockerPicker.tabId,
                id,
              });
              setDockerPicker(null);
            }}
            onCancel={() => {
              dispatchTypedEvent<DockerCancelPayload>('gwshell:docker-cancel', {
                tabId: dockerPicker.tabId,
              });
              setDockerPicker(null);
            }}
          />
        )}
      </div>
      <ToastProvider />
      <ConfirmDialog />
    </I18nextProvider>
  );
}

export default App;
