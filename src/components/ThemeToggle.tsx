import { useEffect, useId, useRef, useState } from 'react';
type Theme = 'system' | 'light' | 'dark';
const choices = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const;

// Original geometric icons; no external artwork or icon dependency.
function ThemeIcon({ kind }: { kind: Theme }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </>
      ) : kind === 'dark' ? (
        <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </>
      )}
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  useEffect(() => {
    const value = document.documentElement.dataset.theme;
    if (value === 'light' || value === 'dark') setTheme(value);
  }, []);
  useEffect(() => {
    if (!open) return;
    items.current[
      choices.findIndex((choice) => choice.value === theme)
    ]?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, theme]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function change(value: Theme) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem('forum-theme', value);
    } catch {
      /* Theme remains usable without storage. */
    }
    close();
  }
  const label = choices.find((choice) => choice.value === theme)!.label;
  return (
    <div
      className="theme-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="theme-trigger"
        aria-label={`外观：${label}`}
        title={`外观：${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="theme-sun">
          <ThemeIcon kind="light" />
        </span>
        <span className="theme-moon">
          <ThemeIcon kind="dark" />
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          className="theme-menu"
          role="menu"
          aria-label="外观"
          onKeyDown={(event) => {
            const index = items.current.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next: number;
            if (event.key === 'ArrowDown') next = (index + 1) % choices.length;
            else if (event.key === 'ArrowUp')
              next = (index + choices.length - 1) % choices.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = choices.length - 1;
            else return;
            event.preventDefault();
            items.current[next]?.focus();
          }}
        >
          {choices.map((choice, index) => (
            <button
              key={choice.value}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={theme === choice.value}
              tabIndex={-1}
              onClick={() => change(choice.value)}
            >
              <ThemeIcon kind={choice.value} />
              <span>{choice.label}</span>
              <span className="theme-check" aria-hidden="true">
                {theme === choice.value ? '✓' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
