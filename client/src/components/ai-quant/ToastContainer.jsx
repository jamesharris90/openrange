import React, { useState, useCallback } from 'react';

// Toast notification system
let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  return { toasts, addToast };
}

export default function ToastContainer({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div className="aiq-toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`aiq-toast aiq-toast-${t.type}`}>
          {t.type === 'success' && '✓ '}
          {t.type === 'error' && '✗ '}
          {t.message}
        </div>
      ))}
    </div>
  );
}
