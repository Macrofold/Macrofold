'use client';

import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import '../components/resize-handle.css';

/** A left pane's width preference and pointer/keyboard separator behavior. */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}) {
  const bound = (value: number) => Math.round(Math.min(maxWidth, Math.max(minWidth, value)));
  const [preferredWidth, setPreferredWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
    element: HTMLDivElement;
    restore: () => void;
  } | null>(null);
  const width = bound(preferredWidth);

  useEffect(() => {
    const sync = () => {
      if (drag.current) return;
      let value = defaultWidth;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null && stored.trim() !== '' && Number.isFinite(Number(stored)))
          value = Number(stored);
      } catch {
        // Resizing remains available when the browser blocks preference storage.
      }
      setPreferredWidth(Math.min(maxWidth, Math.max(minWidth, value)));
    };
    sync();
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) sync();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [storageKey, defaultWidth, minWidth, maxWidth]);

  useEffect(() => () => drag.current?.restore(), []);

  function persist(value: number) {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      // The current page keeps the selection without storage.
    }
  }
  function setWidth(value: number) {
    if (!Number.isFinite(value)) return;
    const next = bound(value);
    setPreferredWidth(next);
    persist(next);
  }
  function finish(cancel = false) {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    active.restore();
    setIsResizing(false);
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    if (cancel) setPreferredWidth(active.startWidth);
    else persist(active.width);
  }

  const handleProps: HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuemin': minWidth,
    'aria-valuemax': maxWidth,
    'aria-valuenow': width,
    'aria-valuetext': `${width} pixels`,
    title: 'Drag to resize. Use arrow keys to adjust, or double-click to reset.',
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      event.preventDefault();
      const element = event.currentTarget;
      element.focus();
      element.setPointerCapture(event.pointerId);
      const style = document.documentElement.style;
      const cursor = style.cursor;
      const userSelect = style.userSelect;
      style.cursor = 'col-resize';
      style.userSelect = 'none';
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
        width,
        element,
        restore: () => {
          style.cursor = cursor;
          style.userSelect = userSelect;
        },
      };
      setIsResizing(true);
    },
    onPointerMove(event) {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.width = bound(active.startWidth + event.clientX - active.startX);
      setPreferredWidth(active.width);
    },
    onPointerUp(event) {
      if (drag.current?.pointerId === event.pointerId) finish();
    },
    onPointerCancel(event) {
      if (drag.current?.pointerId === event.pointerId) finish(true);
    },
    onLostPointerCapture(event) {
      if (drag.current?.pointerId === event.pointerId) finish(true);
    },
    onDoubleClick: () => setWidth(defaultWidth),
    onKeyDown(event) {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        finish(true);
        return;
      }
      const step = event.shiftKey ? 64 : 16;
      const next =
        event.key === 'ArrowLeft'
          ? width - step
          : event.key === 'ArrowRight'
            ? width + step
            : event.key === 'Home'
              ? minWidth
              : event.key === 'End'
                ? maxWidth
                : undefined;
      if (next === undefined || drag.current) return;
      event.preventDefault();
      setWidth(next);
    },
  };
  return { width, setWidth, isResizing, handleProps };
}
