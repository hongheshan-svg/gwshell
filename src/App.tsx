import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TitleBar } from './components/TitleBar/TitleBar';
import { Sidebar } from './components/Sidebar/IconNav';
import { SessionPanel } from './components/Sidebar/SessionPanel';
import { TabBar } from './components/TabBar/TabBar';
import { TerminalContainer } from './components/Terminal/TerminalContainer';
import { SftpPanel } from './components/SftpPanel/SftpPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { NewSessionModal } from './components/Modals/NewSessionModal';
import { DockerModal } from './components/Modals/DockerModal';
import { LocalTerminalModal } from './components/Modals/LocalTerminalModal';
import { SerialPortModal } from './components/Modals/SerialPortModal';
import { SettingsModal } from './components/Settings/SettingsModal';
import { AppMenu } from './components/AppMenu/AppMenu';
import { useAppStore } from './stores/appStore';
import type { SessionConfig } from './types';
import './styles/global.css';

function App() {
  const { theme, setSessions, sidebarCollapsed, toggleSidebar, tabs, activeTabId, sftpPanelOpen, sessions } = useAppStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load persisted sessions from backend on startup
  useEffect(() => {
    invoke<SessionConfig[]>('get_sessions')
      .then((sessions) => { if (sessions.length > 0) setSessions(sessions); })
      .catch(() => {});
  }, []);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-layout">
        <Sidebar />
        <SessionPanel />
        <button
          className="sidebar-collapse-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? '展开面板' : '折叠面板'}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <div className="main-content">
          <TabBar />
          <div className="terminal-sftp-wrapper">
            <TerminalContainer />
            {sftpPanelOpen && (() => {
              const activeTab = tabs.find(t => t.id === activeTabId);
              if (activeTab?.type !== 'ssh') return null;
              const sess = sessions.find(s => s.id === activeTab.sessionId);
              return <SftpPanel sessionId={activeTab.sessionId} username={sess?.username} />;
            })()}
          </div>
          <StatusBar />
        </div>
      </div>
      <NewSessionModal />
      <DockerModal />
      <LocalTerminalModal />
      <SerialPortModal />
      <SettingsModal />
      <AppMenu />
    </div>
  );
}

export default App;
