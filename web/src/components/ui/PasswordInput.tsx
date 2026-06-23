// web/src/components/ui/PasswordInput.tsx

import { useState, forwardRef, InputHTMLAttributes, CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  wrapperStyle?: CSSProperties;
  wrapperClassName?: string;
}

// Drop-in replacement for <input type="password">. Renders an eye icon
// inside the field to toggle plaintext visibility — usable with either
// Tailwind className styling or inline style objects.
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ style, className, wrapperStyle, wrapperClassName, ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div
        className={wrapperClassName}
        style={{ position: 'relative', ...wrapperStyle }}
      >
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={className ? `${className} pr-10` : undefined}
          style={className ? style : { paddingRight: 36, ...style }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            display: 'flex', alignItems: 'center', color: '#9ca3af',
          }}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  }
);
