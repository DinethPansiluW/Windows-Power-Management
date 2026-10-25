/**
 * Verification script for build/icon.ico
 * Ensures build/icon.ico exists, has valid ICO header (00 00 01 00),
 * and contains an entry with 256x256 dimensions (width/height byte 0).
 */

const fs = require('fs');
const path = require('path');

const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

function fail() {
  console.error('build/icon.ico is missing or has no 256x256 size');
  process.exit(1);
}

try {
  if (!fs.existsSync(iconPath)) {
    fail();
  }

  const buffer = fs.readFileSync(iconPath);

  // An ICO header is 6 bytes, and each directory entry is 16 bytes.
  if (buffer.length < 22) {
    fail();
  }

  // Verify first bytes: 00 00 01 00 (Reserved = 0x0000, Type = 0x0001 for icon)
  if (buffer[0] !== 0x00 || buffer[1] !== 0x00 || buffer[2] !== 0x01 || buffer[3] !== 0x00) {
    fail();
  }

  const count = buffer.readUInt16LE(4);
  if (count < 1) {
    fail();
  }

  let has256 = false;
  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    if (entryOffset + 16 > buffer.length) break;

    const width = buffer[entryOffset];
    const height = buffer[entryOffset + 1];

    // In ICO specification, width or height byte 0 means 256 pixels
    if (width === 0 && height === 0) {
      has256 = true;
      break;
    }
  }

  if (!has256) {
    fail();
  }

  console.log('build/icon.ico is valid and contains a 256x256 image.');
  process.exit(0);
} catch (err) {
  fail();
}
