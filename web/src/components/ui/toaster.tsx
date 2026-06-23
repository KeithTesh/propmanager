// web/src/components/ui/toaster.tsx
import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cn } from '../../lib/utils';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { create } from 'zustand';

// ─── TOAST STORE ─────────────────────────────────────────────────────────────

export type ToastVariant = 'default' | 'success' | 'error' | 'info';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => set((s) => ({
    toasts: [...s.toasts, { ...toast, id: crypto.randomUUID() }],
  })),
  remove: (id) => set((s) => ({
    toasts: s.toasts.filter((t) => t.id !== id),
  })),
}));

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export function toast(opts: Omit<Toast, 'id'>) {
  useToastStore.getState().add(opts);
}

export const showSuccess = (title: string, description?: string) =>
  toast({ title, description, variant: 'success' });

export const showError = (title: string, description?: string) =>
  toast({ title, description, variant: 'error', duration: 6000 });

export const showInfo = (title: string, description?: string) =>
  toast({ title, description, variant: 'info' });

// ─── TOASTER COMPONENT ───────────────────────────────────────────────────────

const ICONS: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error:   <AlertCircle className="h-4 w-4 text-red-500" />,
  info:    <Info className="h-4 w-4 text-blue-500" />,
};

export function Toaster() {
  const { toasts, remove } = useToastStore();

  return (
    <ToastPrimitives.Provider swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitives.Root
          key={t.id}
          duration={t.duration ?? 4000}
          onOpenChange={(open) => { if (!open) remove(t.id); }}
          className={cn(
            'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden',
            'rounded-lg border bg-white p-4 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[swipe=end]:animate-out data-[state=closed]:fade-out-80',
            'data-[state=open]:slide-in-from-bottom-full',
            'max-w-sm'
          )}
        >
          {ICONS[t.variant ?? 'default'] && (
            <div className="mt-0.5 shrink-0">{ICONS[t.variant ?? 'default']}</div>
          )}
          <div className="flex-1 min-w-0">
            <ToastPrimitives.Title className="text-sm font-semibold text-foreground">
              {t.title}
            </ToastPrimitives.Title>
            {t.description && (
              <ToastPrimitives.Description className="mt-0.5 text-sm text-muted-foreground">
                {t.description}
              </ToastPrimitives.Description>
            )}
          </div>
          <ToastPrimitives.Close
            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </ToastPrimitives.Close>
        </ToastPrimitives.Root>
      ))}

      <ToastPrimitives.Viewport
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm"
      />
    </ToastPrimitives.Provider>
  );
}