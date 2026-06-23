// web/src/components/ui/Toast.tsx
import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' | 'warning'; }

interface ToastContextType {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++nextId;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const colors = {
    success: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '✅' },
    error:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '❌' },
    warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '⚠️' },
    info:    { bg: '#f0fdfa', border: '#5eead4', text: '#134e4a', icon: 'ℹ️' },
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => {
          const c = colors[t.type];
          return (
            <div key={t.id}
              className="flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium"
              style={{ background: c.bg, borderColor: c.border, color: c.text }}>
              <span className="shrink-0 text-base">{c.icon}</span>
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}