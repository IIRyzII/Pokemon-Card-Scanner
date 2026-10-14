import { CURRENCY_INFO, isCurrency } from '../../../shared/currency.ts';

const formatters = new Map<string, Intl.NumberFormat>();

/** "£1,234.50", "$0.89", "€12.00" — formatted the way that currency's home country writes it. */
export function money(value: number | null | undefined, currency = 'USD', opts: { round?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const round = !!opts.round && Math.abs(value) >= 1000;
  const key = `${currency}|${round}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    const locale = isCurrency(currency) ? CURRENCY_INFO[currency].locale : 'en-GB';
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: round ? 0 : 2 });
    formatters.set(key, fmt);
  }
  return fmt.format(value);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return shortDate(iso);
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
