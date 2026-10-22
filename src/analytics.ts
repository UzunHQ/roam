import { config } from './config';

// Umami: cookieless, no personal data. Location is never sent.
type Umami = { track: (event: string, data?: Record<string, string | number>) => void };
const umami = () => (window as unknown as { umami?: Umami }).umami;

// ?notrack opts this browser out of Umami (its script honours umami.disabled), ?track opts back in.
function applyTrackingParam() {
  const url = new URL(location.href);
  const optOut = url.searchParams.has('notrack');
  if (!optOut && !url.searchParams.has('track')) return;
  try {
    if (optOut) localStorage.setItem('umami.disabled', '1');
    else localStorage.removeItem('umami.disabled');
  } catch {
    /* storage blocked */
  }
  url.searchParams.delete('notrack');
  url.searchParams.delete('track');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function initAnalytics() {
  applyTrackingParam();
  const { umamiScript, umamiWebsiteId } = config.analytics;
  if (!umamiWebsiteId || !import.meta.env.PROD) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = umamiScript;
  s.dataset.websiteId = umamiWebsiteId;
  document.head.appendChild(s);
  window.addEventListener('appinstalled', () => track('install'));
}

export function track(event: 'place-tap' | 'search' | 'install' | 'nav-start', data?: Record<string, string | number>) {
  try {
    umami()?.track(event, data);
  } catch {
    /* analytics must never break the app */
  }
}
