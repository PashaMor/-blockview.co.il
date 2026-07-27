import sharp from 'sharp';

// 1) 512x512 store icon from the 1024 source
await sharp('assets/icon.png').resize(512,512).png().toFile('store/android/icon-512.png');

// 2) 1024x500 feature graphic: dark navy gradient + gold accent + logo + wordmark
const W=1024,H=500;
const bg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1b2a"/>
      <stop offset="1" stop-color="#1b263b"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#E6A23D"/>
      <stop offset="1" stop-color="#C0781A"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect x="0" y="${H-8}" width="${W}" height="8" fill="url(#gold)"/>
  <text x="470" y="215" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#ffffff">BlockView</text>
  <text x="472" y="275" font-family="Arial, sans-serif" font-size="34" font-weight="400" fill="#E6A23D">Tap a building. See what's inside.</text>
  <text x="472" y="325" font-family="Arial, sans-serif" font-size="28" font-weight="400" fill="#cbd5e1">A 3D real-estate map for Israel</text>
</svg>`;
const logo = await sharp('assets/icon.png').resize(300,300).png().toBuffer();
await sharp(Buffer.from(bg))
  .composite([{ input: logo, left: 110, top: 100 }])
  .png().toFile('store/android/feature-graphic-1024x500.png');

console.log('done: icon-512.png, feature-graphic-1024x500.png');
