/**
 * Verification script for build/icon.ico
 * Ensures build/icon.ico exists, has valid ICO header (00 00 01 00),
 * and contains an entry with 256x256 dimensions (width/height byte 0).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
const pngCandidates = [
  path.join(__dirname, '..', 'build', 'icon.png'),
  path.join(__dirname, '..', 'public', 'icon.png'),
  path.join(__dirname, '..', 'renderer', 'icon.png')
];

function fail() {
  console.error('build/icon.ico is missing or has no 256x256 size');
  process.exit(1);
}

function checkIco(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 22) return false;
  if (buffer[0] !== 0x00 || buffer[1] !== 0x00 || buffer[2] !== 0x01 || buffer[3] !== 0x00) return false;
  const count = buffer.readUInt16LE(4);
  if (count < 1) return false;

  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    if (entryOffset + 16 > buffer.length) break;
    const width = buffer[entryOffset];
    const height = buffer[entryOffset + 1];
    if (width === 0 && height === 0) {
      return true;
    }
  }
  return false;
}

try {
  if (!checkIco(iconPath)) {
    // Attempt auto-generation from available PNG if possible
    for (const png of pngCandidates) {
      if (fs.existsSync(png)) {
        try {
          fs.mkdirSync(path.dirname(iconPath), { recursive: true });
          execFileSync('convert', [png, '-define', 'icon:auto-resize=256,128,64,48,32,16', iconPath]);
          if (checkIco(iconPath)) break;
        } catch {}
      }
    }
  }

  if (!checkIco(iconPath)) {
    fail();
  }

  console.log('build/icon.ico is valid and contains a 256x256 image.');
  process.exit(0);
} catch (err) {
  fail();
}
