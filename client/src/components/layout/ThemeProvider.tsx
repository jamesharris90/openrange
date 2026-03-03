import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';

type ThemeProviderProps = {
  children: ReactNode;
};

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <>{children}</>;
}
