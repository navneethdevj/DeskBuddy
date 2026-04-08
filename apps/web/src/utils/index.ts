type ClassValue = string | undefined | null | false;

export const cn = (...classes: ClassValue[]): string =>
  classes.filter(Boolean).join(' ');

export const formatDate = (isoString: string): string =>
  new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
