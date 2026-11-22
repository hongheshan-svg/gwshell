import React, { useEffect, useRef } from 'react';
import { Clock, SquareTerminal } from 'lucide-react';
import type { CompletionView } from '../../lib/terminalCompletionState';

interface CompletionDropdownProps {
  view: CompletionView;
  fontFamily: string;
  fontSize: number;
}

export const CompletionDropdown: React.FC<CompletionDropdownProps> = ({
  view,
  fontFamily,
  fontSize,
}) => {
  const { items, index, navigated, x, y, above, typedLen } = view;
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when navigating past the visible rows.
  useEffect(() => {
    const row = listRef.current?.children[index];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [index, items]);

  if (items.length === 0) return null;

  // Shift left by the icon column so each item's text starts exactly under
  // the typed line (--completion-text-offset matches the row layout in CSS).
  const left = `max(0px, calc(${x} * var(--cell-w) - var(--completion-text-offset)))`;
  const style: React.CSSProperties = above
    ? { left, top: `calc(${y} * var(--cell-h))`, transform: 'translateY(-100%)' }
    : { left, top: `calc(${y + 1} * var(--cell-h))` };

  return (
    <div ref={listRef} className="terminal-completion" style={style}>
      {items.map((it, i) => {
        const state = i !== index ? '' : navigated ? ' is-selected' : ' is-default';
        return (
          <div key={`${it.kind}:${it.text}`} className={`terminal-completion-row${state}`}>
            {it.kind === 'history' ? (
              <Clock className="terminal-completion-icon" size={13} />
            ) : (
              <SquareTerminal className="terminal-completion-icon" size={13} />
            )}
            <span className="terminal-completion-cmd" style={{ fontFamily, fontSize }}>
              <span className="terminal-completion-typed">{it.text.slice(0, typedLen)}</span>
              {it.text.slice(typedLen)}
            </span>
            {it.desc && <span className="terminal-completion-desc">{it.desc}</span>}
          </div>
        );
      })}
    </div>
  );
};
