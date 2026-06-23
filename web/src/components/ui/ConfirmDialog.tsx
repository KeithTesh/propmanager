// web/src/components/ui/ConfirmDialog.tsx
import React, { useState, useEffect } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: (v: boolean) => void;
}

const defaultState: ConfirmState = {
  open: false, title: '', message: '',
  resolve: () => {},
};

// Module-level event emitter pattern — no hooks involved
type Listener = (state: ConfirmState) => void;
let _listener: Listener | null = null;
let _currentState: ConfirmState = defaultState;

function emit(state: ConfirmState) {
  _currentState = state;
  _listener?.(state);
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    emit({ ...options, open: true, resolve });
  });
}

export function useConfirm() {
  return { confirm };
}

export function ConfirmDialogRoot() {
  const [state, setState] = useState<ConfirmState>(defaultState);

  useEffect(() => {
    _listener = setState;
    setState(_currentState); // sync on mount
    return () => { _listener = null; };
  }, []);

  const close = (result: boolean) => {
    state.resolve(result);
    emit({ ...state, open: false });
  };

  if (!state.open) return null;

  const variant = state.variant ?? 'danger';
  const colors = {
    danger:  { btn: '#ef4444', hover: '#dc2626', icon: '⚠️' },
    warning: { btn: '#f59e0b', hover: '#d97706', icon: '⚠️' },
    info:    { btn: '#0d9f9f', hover: '#076666', icon: 'ℹ️' },
  }[variant];

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)',
        display:'flex', alignItems:'center', justifyContent:'center',
        zIndex:9999, padding:'1rem' }}
      onClick={e => { if (e.target === e.currentTarget) close(false); }}>
      <div style={{ background:'white', borderRadius:'1rem', boxShadow:'0 25px 50px rgba(0,0,0,0.25)',
        width:'100%', maxWidth:'400px', padding:'1.5rem' }}>
        <div style={{ fontSize:'2rem', marginBottom:'0.75rem' }}>{colors.icon}</div>
        <h2 style={{ fontSize:'1.1rem', fontWeight:700, color:'#111827', margin:'0 0 0.5rem' }}>
          {state.title}
        </h2>
        <p style={{ fontSize:'0.875rem', color:'#6b7280', margin:'0 0 1.5rem', lineHeight:1.5 }}>
          {state.message}
        </p>
        <div style={{ display:'flex', gap:'0.75rem' }}>
          <button
            onClick={() => close(false)}
            style={{ flex:1, padding:'0.625rem', borderRadius:'0.75rem',
              border:'1px solid #e5e7eb', background:'white', fontSize:'0.875rem',
              fontWeight:500, color:'#374151', cursor:'pointer' }}>
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={() => close(true)}
            style={{ flex:1, padding:'0.625rem', borderRadius:'0.75rem',
              border:'none', background:colors.btn, fontSize:'0.875rem',
              fontWeight:600, color:'white', cursor:'pointer' }}>
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}