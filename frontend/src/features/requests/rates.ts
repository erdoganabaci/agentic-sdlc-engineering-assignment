export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDateTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
