import { API_BASE, APP_BUILD } from './config';

// Crash reporting: every uncaught JS error is sent to /api/log (capped Redis list) so
// production breakage on real phones is visible instead of silent. The original handler
// still runs, so dev behavior (red box) is unchanged.
export function initErrorReporting(){
  const g: any = global as any;
  if (!g.ErrorUtils || g.__5to9ErrHooked) return;
  g.__5to9ErrHooked = true;
  const prev = g.ErrorUtils.getGlobalHandler && g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((e: any, isFatal?: boolean) => {
    try {
      fetch(API_BASE + '/api/log', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: String(e?.message || e), stack: String(e?.stack || '').slice(0, 2000), fatal: !!isFatal, build: APP_BUILD }),
      }).catch(() => {});
    } catch {}
    if (prev) prev(e, isFatal);
  });
}
