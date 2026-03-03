import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import ThemeProvider from './components/layout/ThemeProvider';
import { BrokerProvider } from './context/BrokerContext';

if (import.meta.env.DEV) {
  import('../devtools/chartValidation')
    .then(({ runChartValidation }) => {
      window.runChartValidation = runChartValidation;
    })
    .catch((error) => {
      console.error('Failed to load chart validation harness', error);
    });
}

// Unregister any stale service workers — this app does not use service workers
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrokerProvider>
        <App />
      </BrokerProvider>
    </ThemeProvider>
  </React.StrictMode>
);
