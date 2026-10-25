/**
 * Pre-build helper for electron-builder on Windows:
 * Pre-extracts winCodeSign-2.6.0 excluding darwin/ macOS symlinks to avoid privilege errors.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  // Do nothing unless on Windows
  process.exit(0);
}

function downloadFile(url, destPath, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('Too many redirects while downloading winCodeSign.'));
    }

    const client = url.startsWith('http://') ? http : https;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).href;
        return downloadFile(nextUrl, destPath, maxRedirects - 1).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with status code ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function run() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const targetFolder = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0');

    if (fs.existsSync(targetFolder)) {
      const items = fs.readdirSync(targetFolder);
      if (items.length > 0) {
        console.log('winCodeSign cache OK');
        process.exit(0);
      }
    }

    fs.mkdirSync(targetFolder, { recursive: true });

    const archiveUrl = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
    const tempFile = path.join(os.tmpdir(), `winCodeSign-2.6.0-${Date.now()}.7z`);

    try {
      await downloadFile(archiveUrl, tempFile);
      const { path7za } = require('7zip-bin');
      execFileSync(path7za, ['x', tempFile, '-o' + targetFolder, '-xr!darwin', '-y'], {
        stdio: 'inherit'
      });
    } finally {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // Ignore temp cleanup errors
        }
      }
    }

    console.log('winCodeSign cache OK');
    process.exit(0);
  } catch (err) {
    console.error('Could not prepare the signing tools. Turn on Windows Developer Mode (Settings > Update & Security > For developers) or run the terminal as Administrator, then run npm run dist again.');
    process.exit(1);
  }
}

run();
