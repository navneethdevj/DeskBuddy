import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onDismiss: () => void;
  duration?: number;
}

const STYLES = {
  error:   { bar: 'bg-err',   text: 'text-ink', icon: '✕', sub: 'text-ink-2' },
  success: { bar: 'bg-ok',    text: 'text-ink', icon: '✓', sub: 'text-ink-2' },
  info:    { bar: 'bg-info',  text: 'text-ink', icon: 'ℹ', sub: 'text-ink-2' },
};

export const Toast = ({
  message,
  type = 'error',
  onDismiss,
  duration = 4000,
}: ToastProps): JSX.Element => {
  useEffect(() => {
    const id = setTimeout(onDismiss, duration);
    return () => clearTimeout(id);
  }, [onDismiss, duration]);

  const s = STYLES[type];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-5 right-5 z-[100] flex max-w-sm overflow-hidden rounded-xl border border-border bg-surface shadow-card-lg animate-toast-in"
    >
      {/* Color bar */}
      <div className={`w-1 shrink-0 ${s.bar}`} aria-hidden="true" />

      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <span className={`text-sm font-semibold ${s.bar.replace('bg-', 'text-')}`} aria-hidden="true">
          {s.icon}
        </span>
        <p className={`flex-1 text-sm font-medium ${s.text}`}>{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-1 text-ink-3 transition-colors hover:text-ink-2"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};
