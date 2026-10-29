import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
export type Theme = 'system' | 'light' | 'dark';
const choices = [{ value: 'system', label: '시스템', icon: Monitor }, { value: 'light', label: '라이트', icon: Sun }, { value: 'dark', label: '다크', icon: Moon }] as const;
export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { const value = localStorage.getItem('niulgul-theme'); return value === 'dark' || value === 'light' ? value : 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.appearance = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191d19' : '#f7f7f2');
    };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('niulgul-theme', theme); } catch { /* Session-only when storage is disabled. */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <div className="theme-control" role="group" aria-label="화면 테마">{choices.map(({ value, label, icon: Icon }) =>
    <button key={value} title={label + ' 테마'} aria-label={label + ' 테마'} aria-pressed={theme === value} className={theme === value ? 'active' : ''} onClick={() => setTheme(value)}><Icon size={15} /><span>{label}</span></button>)}</div>;
}
