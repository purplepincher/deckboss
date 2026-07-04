import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const width = 1200;
const height = 630;
const rightWidth = width / 2;
const bg = '#0a1628';
const fg = '#e8edf5';

// Pre-scale/crop the screenshot to fill the right-hand 600x630 area.
const screenshotPath = join(root, 'landing-assets', 'screenshot-record.png');
const screenshotBuf = await sharp(screenshotPath)
  .resize({
    width: Math.round(rightWidth),
    height: height,
    fit: 'cover',
    position: 'right',
  })
  .png()
  .toBuffer();
const screenshotBase64 = screenshotBuf.toString('base64');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  <g font-family="DejaVu Sans, Ubuntu, sans-serif" fill="${fg}">
    <text x="50" y="310" font-size="90" font-weight="700" letter-spacing="-0.02em">DeckBoss</text>
    <text x="50" y="385" font-size="36" font-weight="400">Voice-first fishing log.</text>
    <text x="50" y="432" font-size="36" font-weight="400">No signal needed. Free.</text>
  </g>
  <image x="${rightWidth}" y="0" width="${rightWidth}" height="${height}" preserveAspectRatio="xMaxYMid slice" xlink:href="data:image/png;base64,${screenshotBase64}"/>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: width },
  background: bg,
});
const pngData = resvg.render();
const outPath = join(root, 'public', 'og-card.png');
writeFileSync(outPath, pngData.asPng());
console.log(`Wrote ${outPath}`);
