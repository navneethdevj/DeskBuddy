interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

const getInitials = (name: string): string =>
  name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export const Avatar = ({ name, src, size = 'md' }: AvatarProps): JSX.Element => (
  <div
    className={[
      'relative inline-flex shrink-0 items-center justify-center rounded-full bg-blue-500 font-medium text-white',
      sizeClasses[size],
    ].join(' ')}
    aria-label={name}
    title={name}
  >
    {src ? (
      <img
        src={src}
        alt={name}
        className="h-full w-full rounded-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    ) : (
      getInitials(name)
    )}
  </div>
);
