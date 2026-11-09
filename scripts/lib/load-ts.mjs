// Loads one of the app's TypeScript modules (src/*.ts) into a Node script, bundled with esbuild
// (which comes with Vite), so a check runs the very code the app runs.
import { build } from 'esbuild';

export async function loadTs(path) {
  const r = await build({ entryPoints: [new URL(path, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
