const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

async function createPhotoFixtures(count = 4) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-darkroom-test-'));
  const paths = [];
  const palettes = [
    ['#f4a261', '#264653', '#e76f51'],
    ['#90be6d', '#277da1', '#f9c74f'],
    ['#cdb4db', '#457b9d', '#ffafcc'],
    ['#ff9f1c', '#2ec4b6', '#011627'],
  ];

  for (let index = 0; index < count; index += 1) {
    const [top, bottom, accent] = palettes[index % palettes.length];
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
        <rect width="1600" height="1000" fill="url(#g)"/>
        <circle cx="${340 + index * 120}" cy="320" r="190" fill="${accent}" opacity=".85"/>
        <path d="M0 780 L420 470 L760 710 L1110 390 L1600 760 V1000 H0Z" fill="#111827" opacity=".72"/>
        <rect x="1050" y="160" width="310" height="230" rx="36" fill="#fff" opacity=".35"/>
      </svg>`;
    const filePath = path.join(directory, `fixture-${index + 1}.jpg`);
    await sharp(Buffer.from(svg)).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(filePath);
    paths.push(filePath);
  }

  return {
    directory,
    paths,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

module.exports = { createPhotoFixtures };
