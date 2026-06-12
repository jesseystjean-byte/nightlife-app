import type { EventItem } from './types';

// Events that only have a DATE (no time) arrive as midnight UTC — rendering those in local
// time shows the WRONG DAY (e.g. "Jun 10, 5:00 PM" in Seattle for a Jun 11 event). Detect
// date-only values and format them as a date in UTC, with no fabricated clock time.
export const isDateOnly = (iso: string) => /T00:00:00(\.000)?(Z|\+00:?00)$/.test(iso);
export function fmtDate(iso?: string){
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isDateOnly(iso)) return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', timeZone:'UTC' });
    return d.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  } catch { return iso; }
}
export function fmtTime(iso?: string){
  if (!iso) return '';
  try {
    if (isDateOnly(iso)) return '';
    return new Date(iso).toLocaleString(undefined, { hour:'numeric', minute:'2-digit' }).replace(/\s/g,'').toLowerCase();
  } catch { return ''; }
}
export function fmtPrice(p?: EventItem['price']){
  if (!p) return '';
  if (p.free) return 'Free';
  if (p.min != null && p.max != null) return '$' + Math.round(p.min) + (p.max > p.min ? '\u2013$' + Math.round(p.max) : '');
  if (p.min != null) return '$' + Math.round(p.min) + '+';
  return '';
}

