// Checks on the site's own hardening. Run: npm run check:security
//
// 1. public/.well-known/security.txt (RFC 9116) names a contact and hasn't run out. It has to be
//    renewed once a year: this fails from 30 days before its Expires date.
// 2. The analytics script (Umami) is served from this site as a pinned copy, public/vendor/umami.js,
//    so no code from another site runs in Roam (the page may know your location once you allow
//    it). Checked: the app loads that copy, the page's Content-Security-Policy allows scripts from
//    this site only, and lets the copy send to the host it sends to, and nowhere else of Umami's.
// 3. With --live (needs the network; CI runs it without blocking): has Umami published a newer
//    script than the copy? If so it is saved to tmp/umami-live.js, to read and copy in.
//    With --update: the copy is replaced by Umami's current script. Then read the diff, run this
//    check again (the host it sends to may have changed: vercel.json) and commit.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const COPY = new URL('public/vendor/umami.js', ROOT);
const LIVE_URL = 'https://cloud.umami.is/script.js';
const args = new Set(process.argv.slice(2));
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const sha = (text) => createHash('sha256').update(text).digest('hex');

// ---------- 1. security.txt ----------
{
  const txt = await readFile(new URL('public/.well-known/security.txt', ROOT), 'utf8').catch(() => '');
  const field = (name) => [...txt.matchAll(new RegExp(`^${name}:\\s*(.+)$`, 'gim'))].map((m) => m[1].trim());
  const contacts = field('Contact');
  check('security.txt: there is a contact, and every one is a link', contacts.length > 0 && contacts.every((c) => /^(https:\/\/|mailto:)/.test(c)), contacts.join(', '));
  const expires = Date.parse(field('Expires')[0] ?? '');
  const days = Math.floor((expires - Date.now()) / 86400000);
  check('security.txt: more than 30 days before it expires', days > 30, Number.isFinite(days) ? `${days} days left${days > 30 ? '' : ': renew the Expires line'}` : 'no Expires line');
  check('security.txt: expires within a year, as the standard asks', days <= 366, `${days} days`);
  check('security.txt: no private e-mail address in it', !/@(gmail|outlook|hotmail|icloud|yahoo)\./i.test(txt));
}

// ---------- 2. the analytics script is our own copy ----------
const vercel = JSON.parse(await readFile(new URL('vercel.json', ROOT), 'utf8'));
const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
const directive = (name) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1);
const config = await readFile(new URL('src/config.ts', ROOT), 'utf8');
const src = config.match(/umamiScript:\s*'([^']*)'/)?.[1] ?? '';
if (existsSync(COPY)) {
  const copy = await readFile(COPY, 'utf8');
  check('analytics: the app loads the copy on this site', src === '/vendor/umami.js', src);
  check("analytics: the page runs scripts from this site only (script-src 'self')", JSON.stringify(directive('script-src')) === JSON.stringify(["'self'"]), directive('script-src').join(' '));
  const hosts = [...new Set(copy.match(/https:\/\/[a-z0-9.-]+/g) ?? [])].filter((h) => h !== 'https://localhost');
  const allowed = directive('connect-src');
  check('analytics: the copy can send to its host', hosts.length > 0 && hosts.every((h) => allowed.includes(h)), `${hosts.join(', ')} | connect-src ${allowed.join(' ')}`);
  const spare = allowed.filter((h) => /umami/.test(h) && !hosts.includes(h));
  check("analytics: connect-src names no other host of Umami's", spare.length === 0, spare.join(', '));
  console.log(`     copy: ${copy.length} bytes, sha256 ${sha(copy)}`);
} else {
  console.log(`--   analytics: no copy at public/vendor/umami.js yet; the app loads ${src}`);
}

// ---------- 3. against Umami's current script ----------
if (args.has('--live') || args.has('--update')) {
  try {
    const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const live = await res.text();
    if (!/umami/.test(live) || live.length < 1000) throw new Error('that does not look like the tracker script');
    const copy = existsSync(COPY) ? await readFile(COPY, 'utf8') : null;
    console.log(`     live: ${live.length} bytes, sha256 ${sha(live)}`);
    if (copy === live) console.log('ok   analytics: the copy is Umami\'s current script');
    else if (args.has('--update')) {
      await mkdir(new URL('public/vendor/', ROOT), { recursive: true });
      await writeFile(COPY, live);
      console.log('     analytics: public/vendor/umami.js replaced. Read the diff, run this check again, commit.');
    } else {
      await mkdir(new URL('tmp/', ROOT), { recursive: true });
      await writeFile(new URL('tmp/umami-live.js', ROOT), live);
      const msg = copy === null ? 'there is no copy yet' : 'Umami has published a newer script than the copy';
      console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : '!    '}analytics: ${msg}. Saved to tmp/umami-live.js (npm run check:security -- --update copies it in).`);
    }
  } catch (e) {
    console.log(`--   analytics: couldn't reach ${LIVE_URL} (${e.message}); the copy wasn't compared`);
  }
}

console.log(failed ? `check:security: ${failed} failed` : 'check:security: all passed');
process.exit(failed ? 1 : 0);
