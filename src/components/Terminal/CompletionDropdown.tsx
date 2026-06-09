import React from 'react';
import { Clock, SquareTerminal } from 'lucide-react';
import type { Completion } from '../../lib/completion';

interface CompletionDropdownProps {
  items: Completion[];
  selectedIndex: number;
  x: number;          // cursor cell column
  y: number;          // cursor cell row
  placeAbove: boolean; // render above the cursor instead of below
  fontFamily: string;
  fontSize: number;
}

export const CompletionDropdown: React.FC<CompletionDropdownProps> = ({
  items,
  selectedIndex,
  x,
  y,
  placeAbove,
  fontFamily,
  fontSize,
}) => {
  if (items.length === 0) return null;
  const style: React.CSSProperties = placeAbove
    ? { left: `calc(${x} * var(--cell-w))`, top: `calc(${y} * var(--cell-h))`, transform: 'translateY(-100%)' }
    : { left: `calc(${x} * var(--cell-w))`, top: `calc(${y + 1} * var(--cell-h))` };

  return (
    <div className="terminal-completion" style={style}>
      {items.map((it, i) => (
        <div
          key={`${it.kind}:${it.text}`}
          className={`terminal-completion-row${i === selectedIndex ? ' is-selected' : ''}`}
        >
          {it.kind === 'history' ? (
            <Clock className="terminal-completion-icon" size={13} />
          ) : (
            <SquareTerminal className="terminal-completion-icon" size={13} />
          )}
          <span className="terminal-completion-cmd" style={{ fontFamily, fontSize }}>
            {it.text}
          </span>
          {it.desc && <span className="terminal-completion-desc">{it.desc}</span>}
        </div>
      ))}
    </div>
  );
};
