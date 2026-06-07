import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:   'bg-accent text-bg hover:bg-accent-hover font-semibold focus-visible:ring-accent shadow-sm',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3 border border-border focus-visible:ring-border-2',
  ghost:     'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:ring-border',
  danger:    'bg-err text-ink hover:bg-red-500 focus-visible:ring-err shadow-sm',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5 rounded-lg',
  md: 'px-4 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-5 py-2.5 text-base gap-2 rounded-xl',
};

export const Button = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps): JSX.Element => (
  <button
    {...props}
    disabled={disabled ?? isLoading}
    aria-busy={isLoading}
    className={[
      'inline-flex items-center justify-center font-medium transition-all duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      'disabled:pointer-events-none disabled:opacity-40',
      'active:scale-[0.97]',
      variantClasses[variant],
      sizeClasses[size],
      className,
    ].join(' ')}
  >
    {isLoading && (
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
    )}
    {children}
  </button>
);
