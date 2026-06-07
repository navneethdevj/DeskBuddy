import { memo } from 'react';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

/** Deterministic warm color from name string — avoids generic blue */
const AVATAR_COLORS = [
  '#c87830', // amber
  '#4ca870', // teal-green
  '#7060c8', // violet
  '#d06040', // terracotta
  '#40a0c0', // steel blue
  '#c05880', // rose
  '#60a048', // sage
];

const nameColor = (name: string): string => {
  const code = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
};

const getInitials = (name: string): string =>
  name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

export const Avatar = memo(({ name, src, size = 'md' }: AvatarProps): JSX.Element => (
  <div
    className={[
      'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-bg ring-1 ring-border',
      sizeClasses[size],
    ].join(' ')}
    style={{ backgroundColor: nameColor(name) }}
    aria-label={name}
    title={name}
  >
    {src ? (
      <img
        src={src}
        alt={name}
        className="h-full w-full rounded-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    ) : (
      getInitials(name)
    )}
  </div>
));

Avatar.displayName = 'Avatar';
