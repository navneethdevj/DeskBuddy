import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, id, className = '', ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      <input
        {...props}
        id={id}
        ref={ref}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={[
          'rounded-lg border bg-surface-2 px-3 py-2 text-sm text-ink shadow-sm transition-all duration-150',
          'placeholder:text-ink-3',
          'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-bg focus:border-transparent',
          error ? 'border-err focus:ring-err' : 'border-border hover:border-border-2',
          className,
        ].join(' ')}
      />
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-err">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  )
);

Input.displayName = 'Input';
