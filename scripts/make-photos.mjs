// Turns entrance photos into small WebP files for the app.
// Put originals in photos-src/<place-id>.jpg (or .jpeg/.png/.heic), then: npm run photos
// Output: public/photos/<place-id>.webp, 1200 px wide, quality 70.
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const src = new URL('../photos-src/', import.meta.url);
const out = new URL('../public/photos/', import.meta.url);
if (!existsSync(src)) { console.log('Create photos-src/ and put <place-id>.jpg files in it.'); process.exit(0); }
await mkdir(out, { recursive: true });

for (const f of await readdir(src)) {
  if (!/\.(jpe?g|png|heic|webp)$/i.test(f)) continue;
  const id = f.replace(/\.[^.]+$/, '');
  const dest = new URL(`${id}.webp`, out).pathname;
  const info = await sharp(new URL(f, src).pathname).rotate().resize({ width: 1200, height: 675, fit: 'cover' }).webp({ quality: 70 }).toFile(dest);
  console.log(`${id}.webp  ${(info.size / 1024).toFixed(0)} KB  -> set "photo": "photos/${id}.webp" in data/places.json`);
}
