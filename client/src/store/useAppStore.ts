import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppState {
  theme: 'light' | 'dark';
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  interactiveMode: boolean;
  allowedStructures: string[];
  filters: Record<string, any>;
  spyState: {
    bias: 'bullish' | 'bearish' | 'neutral';
    volatilityDecile: number;
    session: 'premarket' | 'open' | 'midday' | 'powerhour';
  };
  setTheme: (theme: 'light' | 'dark') => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  toggleInteractive: () => void;
  setFilters: (filters: any) => void;
  setSpyState: (state: any) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      interactiveMode: false,
      allowedStructures: [],
      filters: {},
      spyState: {
        bias: 'neutral',
        volatilityDecile: 5,
        session: 'open',
      },
      setTheme: (theme) => set({ theme }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleMobileSidebar: () => set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),
      toggleInteractive: () => set((state) => ({ interactiveMode: !state.interactiveMode })),
      setFilters: (filters) => set({ filters }),
      setSpyState: (spyState) => set({ spyState }),
    }),
    {
      name: 'openrange-app-store',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        interactiveMode: state.interactiveMode,
      }),
    }
  )
);
