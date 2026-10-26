import { useEffect, useState } from 'react';
type Theme = 'system' | 'light' | 'dark';
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const value = document.documentElement.dataset.theme;
    if (value === 'light' || value === 'dark') setTheme(value);
  }, []);
  function change(value: Theme) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem('forum-theme', value);
    } catch {
      /* Theme remains usable without storage. */
    }
  }
  return (
    <label className="theme-picker">
      <span className="sr-only">外观</span>
      <select
        aria-label="外观"
        value={theme}
        onChange={(e) => change(e.target.value as Theme)}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
