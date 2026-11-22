import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

interface UsePanelResizeOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  /** 'left' = dragging left increases width (right-docked panel); 'right' = dragging right increases width. */
  edge?: 'left' | 'right';
}

export function usePanelResize({
  initialWidth,
  minWidth,
  maxWidth,
  edge = 'left',
}: UsePanelResizeOptions) {
  const [width, setWidth] = useState(initialWidth);
  const resizingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      cleanupRef.current?.();
      resizingRef.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = edge === 'left' ? startX - ev.clientX : ev.clientX - startX;
        setWidth(Math.max(minWidth, Math.min(maxWidth, startWidth + delta)));
      };

      const cleanup = () => {
        resizingRef.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', cleanup);
        if (cleanupRef.current === cleanup) cleanupRef.current = null;
      };

      cleanupRef.current = cleanup;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', cleanup);
    },
    [edge, maxWidth, minWidth, width],
  );

  return { width, onResizeMouseDown };
}
