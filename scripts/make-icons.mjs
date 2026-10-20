// Renders the PWA icons from public/icons/icon.svg. Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const dir = new URL('../public/icons/', import.meta.url);
const svg = await readFile(new URL('icon.svg', dir));
const maskable = await readFile(new URL('icon-maskable.svg', dir));

const jobs = [
  [svg, 'icon-192.png', 192],
  [svg, 'icon-512.png', 512],
  [maskable, 'icon-maskable-512.png', 512],
  [maskable, 'apple-touch-icon.png', 180],
];
for (const [src, name, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(new URL(name, dir).pathname);
  console.log('wrote', name);
}
