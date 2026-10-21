// ABOUTME: Post-build script — copies manifest.json and creates placeholder icons in dist.

import { copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');

mkdirSync(resolve(dist, 'icons'), { recursive: true });

copyFileSync(resolve(__dirname, '..', 'manifest.json'), resolve(dist, 'manifest.json'));

const placeholderPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(dist, 'icons', `icon${size}.png`), placeholderPng);
}

console.log('✅ Post-build complete — manifest and icons copied to dist/');
