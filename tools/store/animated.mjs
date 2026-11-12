/* Which images in a buddy file move by themselves: an animated GIF, WebP or PNG plays on the browser's
   own clock, so a screenshot of it can't be the same twice. The screenshots refuse such a sample. */

/* More than one frame, by the format's own markers. Anything this can't read counts as still. */
export function isAnimated(b) {
  const ascii = (at, n) => b.subarray(at, at + n).toString('latin1');
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') {
    /* APNG: an acTL chunk before the image data */
    for (let i = 8; i + 8 <= b.length;) {
      const n = b.readUInt32BE(i), type = ascii(i + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      i += 12 + n;
    }
    return false;
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    for (let i = 12; i + 8 <= b.length;) {
      const type = ascii(i, 4), n = b.readUInt32LE(i + 4);
      if (type === 'ANIM' || type === 'ANMF') return true;
      if (type === 'VP8X' && b[i + 8] & 0x02) return true; /* the animation flag */
      i += 8 + n + (n & 1);
    }
    return false;
  }
  if (ascii(0, 3) === 'GIF') {
    /* walk the blocks and count images */
    let i = 13, frames = 0;
    if (b[10] & 0x80) i += 3 << ((b[10] & 7) + 1);
    const skipBlocks = j => { while (j < b.length && b[j]) j += b[j] + 1; return j + 1; };
    while (i < b.length) {
      if (b[i] === 0x21) i = skipBlocks(i + 2);
      else if (b[i] === 0x2c) {
        if (++frames > 1) return true;
        const local = b[i + 9];
        i += 10;
        if (local & 0x80) i += 3 << ((local & 7) + 1);
        i = skipBlocks(i + 1);
      } else break;
    }
    return false;
  }
  return false;
}

/* Where each moving image is in a buddy file's text: the JSON path of its data URL. */
export function animatedImages(text) {
  const found = [];
  const walk = (v, at) => {
    if (typeof v === 'string') {
      const m = /^data:image\/[\w.+-]+;base64,/.exec(v);
      if (m && isAnimated(Buffer.from(v.slice(m[0].length), 'base64'))) found.push(at);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(JSON.parse(text), '');
  return found;
}
