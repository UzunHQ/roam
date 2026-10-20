import { config } from './config';

// Umami: cookieless, no personal data. Location is never sent.
type Umami = { track: (event: string, data?: Record<string, string | number>) => void };
const umami = () => (window as unknown as { umami?: Umami }).umami;

export function initAnalytics() {
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
