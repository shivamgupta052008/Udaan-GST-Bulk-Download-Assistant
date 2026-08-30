import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function build() {
  console.log('[Build] 1. Running Vite multi-page build...');
  execSync('npx vite build', { stdio: 'inherit' });

  console.log('[Build] 2. Bundling background service worker with esbuild...');
  execSync(
    'npx esbuild src/background/serviceWorker.ts --bundle --format=esm --target=es2022 --outfile=dist/serviceWorker.js',
    { stdio: 'inherit' }
  );
  execSync(
    'npx esbuild src/background/serviceWorker.ts --bundle --format=esm --target=es2022 --outfile=serviceWorker.js',
    { stdio: 'inherit' }
  );

  console.log('[Build] 3. Bundling GST portal content script detector with esbuild...');
  execSync(
    'npx esbuild src/content/gstPortalDetector.ts --bundle --format=iife --target=es2022 --outfile=dist/gstPortalDetector.js',
    { stdio: 'inherit' }
  );
  execSync(
    'npx esbuild src/content/gstPortalDetector.ts --bundle --format=iife --target=es2022 --outfile=gstPortalDetector.js',
    { stdio: 'inherit' }
  );

  console.log('[Build] 4. Ensuring icons and assets in dist and root...');
  const publicIconsDir = path.resolve('public/icons');
  const distIconsDir = path.resolve('dist/icons');
  const rootIconsDir = path.resolve('icons');

  if (!fs.existsSync(distIconsDir)) fs.mkdirSync(distIconsDir, { recursive: true });
  if (!fs.existsSync(rootIconsDir)) fs.mkdirSync(rootIconsDir, { recursive: true });

  if (fs.existsSync(publicIconsDir)) {
    const iconFiles = fs.readdirSync(publicIconsDir);
    for (const file of iconFiles) {
      fs.copyFileSync(path.join(publicIconsDir, file), path.join(distIconsDir, file));
      fs.copyFileSync(path.join(publicIconsDir, file), path.join(rootIconsDir, file));
    }
  }

  console.log('[Build] 5. Copying root extension files...');
  fs.copyFileSync(path.resolve('public/manifest.json'), path.resolve('dist/manifest.json'));
  fs.copyFileSync(path.resolve('public/manifest.json'), path.resolve('manifest.json'));

  console.log('[Build] Extension and Web application built successfully!');
}

build().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
