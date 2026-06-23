// web/src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { queryClient } from './lib/queryClient';
import { AppRouter } from './router';
import { AuthBootstrap } from './components/auth/AuthBootstrap';
import { ToastProvider } from './components/ui/Toast';
import { ConfirmDialogRoot } from './components/ui/ConfirmDialog';
import { Toaster } from './components/ui/toaster';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Restores session on page load via /api/v1/auth/refresh */}
        <ToastProvider>
          <AuthBootstrap>
            <AppRouter />
            <Toaster />
            <ConfirmDialogRoot />
          </AuthBootstrap>
        </ToastProvider>
      </BrowserRouter>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>
);