import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar/TitleBar';
import { Sidebar } from './components/Sidebar/IconNav';
import { SessionPanel } from './components/Sidebar/SessionPanel';
import { TabBar } from './components/TabBar/TabBar';
import { TerminalContainer } from './components/Terminal/TerminalContainer';
import { StatusBar } from './components/StatusBar/StatusBar';
import { NewSessionModal } from './components/Modals/NewSessionModal';
import { DockerModal } from './components/Modals/DockerModal';
import { LocalTerminalModal } from './components/Modals/LocalTerminalModal';
import { AppMenu } from './components/AppMenu/AppMenu';
import { useAppStore } from './stores/appStore';
import './styles/global.css';

function App() {
  const { theme } = useAppStore();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-layout">
        <Sidebar />
        <SessionPanel />
        <div className="main-content">
          <TabBar />
          <TerminalContainer />
          <StatusBar />
        </div>
      </div>
      <NewSessionModal />
      <DockerModal />
      <LocalTerminalModal />
      <AppMenu />
    </div>
  );
}

export default App;
