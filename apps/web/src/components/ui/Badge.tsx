type Variant = 'gray' | 'blue' | 'green' | 'yellow' | 'red';

interface BadgeProps {
  label: string;
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  gray:   'bg-surface-3 text-ink-2 border-border',
  blue:   'bg-info-muted text-info border-info/20',
  green:  'bg-ok-muted text-ok border-ok/20',
  yellow: 'bg-accent-dim text-accent border-accent/20',
  red:    'bg-err-muted text-err border-err/20',
};

export const Badge = ({ label, variant = 'gray' }: BadgeProps): JSX.Element => (
  <span
    className={[
      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tracking-wide',
      variantClasses[variant],
    ].join(' ')}
  >
    {label}
  </span>
);
