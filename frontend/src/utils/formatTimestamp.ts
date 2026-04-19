/**
 * Smart timestamp formatter for chat messages.
 *
 * - Today → "6:32 PM"
 * - Yesterday → "Yesterday 6:32 PM"
 * - Same year → "Apr 15 6:32 PM"
 * - Different year → "Apr 15, 2024 6:32 PM"
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (msgDay.getTime() === today.getTime()) {
    return time;
  }
  if (msgDay.getTime() === yesterday.getTime()) {
    return `Yesterday ${time}`;
  }

  const month = date.toLocaleString(undefined, { month: 'short' });
  const day = date.getDate();

  if (date.getFullYear() === now.getFullYear()) {
    return `${month} ${day} ${time}`;
  }
  return `${month} ${day}, ${date.getFullYear()} ${time}`;
}
