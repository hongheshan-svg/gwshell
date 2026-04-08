import { useEffect, useRef } from 'react';
import './styles/ai.css';
import { useAppStore } from '../../stores/appStore';
import { SmokeCard } from './_smoke/SmokeCard';

export function AiSection() {
  const theme = useAppStore((s) => s.theme);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div ref={rootRef} className={`ai-scope ${theme === 'dark' ? 'dark' : ''}`}>
      <SmokeCard />
    </div>
  );
}

export default AiSection;