'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Monitor, Moon, Sun } from 'lucide-react';
import { themeStorageKey as storageKey } from '../lib/theme';

type Theme = 'system' | 'light' | 'dark';
type ResolvedTheme = Exclude<Theme, 'system'>;
const themeOptions = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor },
] as const;
const ThemeContext = createContext<{ theme: Theme; resolved: ResolvedTheme; select: (theme: Theme) => void }>(
  {
    theme: 'system',
    resolved: 'dark',
    select: () => {},
  },
);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('dark');
  const selection = useRef<Theme>('system');
  function apply(value: ResolvedTheme) {
    document.documentElement.dataset.theme = value;
    setResolved(value);
  }
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      let selected: Theme = 'system';
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored === 'light' || stored === 'dark') selected = stored;
      } catch {
        /* Appearance still works for this page when storage is unavailable. */
      }
      selection.current = selected;
      setTheme(selected);
      apply(selected === 'system' ? (media.matches ? 'dark' : 'light') : selected);
    };
    sync();
    const systemChanged = () => {
      if (selection.current === 'system') apply(media.matches ? 'dark' : 'light');
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) sync();
    };
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    return () => {
      media.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);
  function select(next: Theme) {
    selection.current = next;
    setTheme(next);
    apply(
      next === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : next,
    );
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Session-only preference. */
    }
  }
  return <ThemeContext.Provider value={{ theme, resolved, select }}>{children}</ThemeContext.Provider>;
}

export function useResolvedTheme() {
  return useContext(ThemeContext).resolved;
}

export function ThemeControl() {
  const { theme, select } = useContext(ThemeContext);
  return (
    <div className="theme-control" role="group" aria-label="Appearance">
      {themeOptions.map(({ id, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={`Use ${id} theme`}
          title={`${id[0].toUpperCase()}${id.slice(1)} theme`}
          aria-pressed={theme === id}
          onClick={() => select(id)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

/** Compact appearance controls participate in the account menu's roving focus. */
export function ThemeMenuControl() {
  const { theme, select } = useContext(ThemeContext);
  return (
    <div className="profile-menu-appearance">
      <span>Appearance</span>
      <DropdownMenu.RadioGroup
        className="theme-control theme-menu-control"
        aria-label="Appearance"
        value={theme}
        onValueChange={(next) => {
          if (next === 'light' || next === 'dark' || next === 'system') select(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
          const current = buttons.findIndex((button) => button === event.target);
          if (current < 0) return;
          event.preventDefault();
          event.stopPropagation();
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          buttons[(current + direction + buttons.length) % buttons.length]?.focus();
        }}
      >
        {themeOptions.map(({ id, icon: Icon }) => (
          <DropdownMenu.RadioItem key={id} value={id} asChild onSelect={(event) => event.preventDefault()}>
            <button
              type="button"
              aria-label={`Use ${id} theme`}
              title={`${id[0].toUpperCase()}${id.slice(1)} theme`}
            >
              <Icon size={15} />
            </button>
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </div>
  );
}
