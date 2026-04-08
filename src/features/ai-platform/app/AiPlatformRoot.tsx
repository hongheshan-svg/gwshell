import { useEffect, useRef } from 'react';
import { useAppStore } from '../../../stores/appStore';
import './AiPlatformRoot.css';
import '../shared/styles/ai-platform.css';
import { AiPlatformShell } from './AiPlatformShell';
import { AiPlatformProviders } from './AiPlatformProviders';

export function AiPlatformRoot() {
  const theme = useAppStore((state) => state.theme);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    element.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <AiPlatformProviders>
      <div ref={rootRef} className={`ai-scope ${theme === 'dark' ? 'dark' : ''}`}>
        <AiPlatformShell />
      </div>
    </AiPlatformProviders>
  );
}

export default AiPlatformRoot;