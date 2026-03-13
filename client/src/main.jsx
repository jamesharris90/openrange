import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/designSystem.css';
import ThemeProvider from './components/layout/ThemeProvider';
import { BrokerProvider } from './context/BrokerContext';
import { SymbolProvider } from './context/SymbolContext';
import { AuthProvider } from './context/AuthContext';
import { FeatureAccessProvider } from "./context/FeatureAccessContext";
import ErrorBoundary from "./components/ErrorBoundary";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

if (import.meta.env.DEV) {
  import('../devtools/chartValidation')
    .then(({ runChartValidation }) => {
      window.runChartValidation = runChartValidation;
    })
    .catch((error) => {
      console.error('Failed to load chart validation harness', error);
    });
}

// Register service worker for PWA offline cache and push events.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrokerProvider>
            <AuthProvider>
              <FeatureAccessProvider>
                <SymbolProvider>
                  <App />
                </SymbolProvider>
              </FeatureAccessProvider>
            </AuthProvider>
          </BrokerProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
