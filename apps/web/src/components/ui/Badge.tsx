type Variant = 'gray' | 'blue' | 'green' | 'yellow' | 'red';

interface BadgeProps {
  label: string;
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
};

export const Badge = ({ label, variant = 'gray' }: BadgeProps): JSX.Element => (
  <span
    className={[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      variantClasses[variant],
    ].join(' ')}
  >
    {label}
  </span>
);
