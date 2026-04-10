import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { applyTheme } from '../../system/theme';

type ThemeProviderProps = {
  children: ReactNode;
};

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <>{children}</>;
}
