import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onDismiss: () => void;
  duration?: number;
}

const COLORS = {
  error: 'bg-red-50 border-red-200 text-red-800',
  success: 'bg-green-50 border-green-200 text-green-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const ICONS = {
  error: '⚠',
  success: '✓',
  info: 'ℹ',
};

export const Toast = ({
  message,
  type = 'error',
  onDismiss,
  duration = 4000,
}: ToastProps): JSX.Element => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [onDismiss, duration]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        'fixed bottom-5 right-5 z-[100] flex max-w-sm items-center gap-3',
        'rounded-xl border px-4 py-3 shadow-lg',
        COLORS[type],
      ].join(' ')}
    >
      <span className="text-base leading-none">{ICONS[type]}</span>
      <span className="flex-1 text-sm font-medium">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-1 text-current opacity-50 hover:opacity-100 transition-opacity text-lg leading-none"
      >
        ✕
      </button>
    </div>
  );
};
