/**
 * skeletonify.js — Port of skeletonify.py
 * Zhang-Suen thinning + skeleton tracing → SVG polylines.
 * Requires OpenCV.js (cv) to be loaded.
 */

// ============================================================
// Zhang-Suen thinning algorithm
// ============================================================

function thinningZSIteration(im, w, h, iter) {
  const marker = new Uint8Array(w * h);

  for (let i = 1; i < h - 1; i++) {
    for (let j = 1; j < w - 1; j++) {
      if (!im[i * w + j]) continue;

      const p2 = im[(i - 1) * w + j];
      const p3 = im[(i - 1) * w + j + 1];
      const p4 = im[i * w + j + 1];
      const p5 = im[(i + 1) * w + j + 1];
      const p6 = im[(i + 1) * w + j];
      const p7 = im[(i + 1) * w + j - 1];
      const p8 = im[i * w + j - 1];
      const p9 = im[(i - 1) * w + j - 1];

      const A =
        (p2 === 0 && p3 ? 1 : 0) +
        (p3 === 0 && p4 ? 1 : 0) +
        (p4 === 0 && p5 ? 1 : 0) +
        (p5 === 0 && p6 ? 1 : 0) +
        (p6 === 0 && p7 ? 1 : 0) +
        (p7 === 0 && p8 ? 1 : 0) +
        (p8 === 0 && p9 ? 1 : 0) +
        (p9 === 0 && p2 ? 1 : 0);

      const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;

      const m1 = iter === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
      const m2 = iter === 0 ? p4 * p6 * p8 : p2 * p6 * p8;

      if (A === 1 && B >= 2 && B <= 6 && m1 === 0 && m2 === 0) {
        marker[i * w + j] = 1;
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (marker[i]) im[i] = 0;
  }
}

function thinningZS(im, w, h) {
  const prev = new Uint8Array(w * h);
  while (true) {
    prev.set(im);
    thinningZSIteration(im, w, h, 0);
    thinningZSIteration(im, w, h, 1);
    let diff = 0;
    for (let i = 0; i < w * h; i++) diff += Math.abs(prev[i] - im[i]);
    if (diff === 0) break;
  }
}

// ============================================================
// Skeleton tracing (divide and conquer)
// ============================================================

const HORIZONTAL = 1;
const VERTICAL = 2;

function mergeImpl(c0, c1, i, sx, isv, mode) {
  const B0 = (mode >> 1 & 1) > 0;
  const B1 = (mode >> 0 & 1) > 0;
  let mj = -1;
  let md = 4;

  const p1 = c1[i][B1 ? 0 : c1[i].length - 1];
  if (Math.abs(p1[isv ? 1 : 0] - sx) > 0) return false;

  for (let j = 0; j < c0.length; j++) {
    const p0 = c0[j][B0 ? 0 : c0[j].length - 1];
    if (Math.abs(p0[isv ? 1 : 0] - sx) > 1) continue;

    const d = Math.abs(p0[isv ? 0 : 1] - p1[isv ? 0 : 1]);
    if (d < md) {
      mj = j;
      md = d;
    }
  }

  if (mj !== -1) {
    if (B0 && B1) {
      c0[mj] = c1[i].slice().reverse().concat(c0[mj]);
    } else if (!B0 && B1) {
      c0[mj] = c0[mj].concat(c1[i]);
    } else if (B0 && !B1) {
      c0[mj] = c1[i].concat(c0[mj]);
    } else {
      c0[mj] = c0[mj].concat(c1[i].slice().reverse());
    }
    c1.splice(i, 1);
    return true;
  }
  return false;
}

function mergeFrags(c0, c1, sx, dr) {
  for (let i = c1.length - 1; i >= 0; i--) {
    const isv = dr !== HORIZONTAL;
    if (mergeImpl(c0, c1, i, sx, isv, 1)) continue;
    if (mergeImpl(c0, c1, i, sx, isv, 3)) continue;
    if (mergeImpl(c0, c1, i, sx, isv, 0)) continue;
    if (mergeImpl(c0, c1, i, sx, isv, 2)) continue;
  }
  c0.push(...c1);
}

function chunkToFrags(im, w, x, y, cw, ch) {
  const frags = [];
  let on = false;
  let li = -1, lj = -1;

  for (let k = 0; k < ch + ch + cw + cw - 4; k++) {
    let i = 0, j = 0;
    if (k < cw) {
      i = y; j = x + k;
    } else if (k < cw + ch - 1) {
      i = y + k - cw + 1; j = x + cw - 1;
    } else if (k < cw + ch + cw - 2) {
      i = y + ch - 1; j = x + cw - (k - cw - ch + 3);
    } else {
      i = y + ch - (k - cw - ch - cw + 4); j = x;
    }

    if (im[i * w + j]) {
      if (!on) {
        on = true;
        frags.push([[j, i], [x + Math.floor(cw / 2), y + Math.floor(ch / 2)]]);
      }
    } else {
      if (on) {
        const last = frags[frags.length - 1];
        last[0][0] = Math.floor((last[0][0] + lj) / 2);
        last[0][1] = Math.floor((last[0][1] + li) / 2);
        on = false;
      }
    }
    li = i;
    lj = j;
  }

  if (frags.length === 2) {
    const f = [frags[0][0], frags[1][0]];
    frags.length = 0;
    frags.push(f);
  } else if (frags.length > 2) {
    let ms = 0, mi = -1, mj = -1;
    for (let i = y + 1; i < y + ch - 1; i++) {
      for (let j = x + 1; j < x + cw - 1; j++) {
        let s = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            s += im[(i + di) * w + (j + dj)];
          }
        }
        if (s > ms) {
          mi = i; mj = j; ms = s;
        } else if (s === ms &&
          Math.abs(j - (x + Math.floor(cw / 2))) + Math.abs(i - (y + Math.floor(ch / 2))) <
          Math.abs(mj - (x + Math.floor(cw / 2))) + Math.abs(mi - (y + Math.floor(ch / 2)))) {
          mi = i; mj = j; ms = s;
        }
      }
    }
    if (mi !== -1) {
      for (let i = 0; i < frags.length; i++) {
        frags[i][1] = [mj, mi];
      }
    }
  }

  return frags;
}

function notEmpty(im, w, x, y, cw, ch) {
  for (let i = y; i < y + ch; i++) {
    for (let j = x; j < x + cw; j++) {
      if (im[i * w + j]) return true;
    }
  }
  return false;
}

function traceSkeleton(im, imgW, x, y, w, h, csize, maxIter) {
  let frags = [];
  if (maxIter === 0) return frags;
  if (w <= csize && h <= csize) {
    return chunkToFrags(im, imgW, x, y, w, h);
  }

  const totalDim = h + w; // approximate ms initial
  let ms = totalDim;
  let mi = -1, mj = -1;

  if (h > csize) {
    for (let i = y + 3; i < y + h - 3; i++) {
      if (im[i * imgW + x] || im[(i - 1) * imgW + x] ||
          im[i * imgW + x + w - 1] || im[(i - 1) * imgW + x + w - 1]) continue;
      let s = 0;
      for (let j = x; j < x + w; j++) {
        s += im[i * imgW + j];
        s += im[(i - 1) * imgW + j];
      }
      if (s < ms) { ms = s; mi = i; }
      else if (s === ms && Math.abs(i - (y + Math.floor(h / 2))) < Math.abs(mi - (y + Math.floor(h / 2)))) {
        ms = s; mi = i;
      }
    }
  }

  if (w > csize) {
    for (let j = x + 3; j < x + w - 2; j++) {
      if (im[y * imgW + j] || im[(y + h - 1) * imgW + j] ||
          im[y * imgW + j - 1] || im[(y + h - 1) * imgW + j - 1]) continue;
      let s = 0;
      for (let i = y; i < y + h; i++) {
        s += im[i * imgW + j];
        s += im[i * imgW + j - 1];
      }
      if (s < ms) { ms = s; mi = -1; mj = j; }
      else if (s === ms && Math.abs(j - (x + Math.floor(w / 2))) < Math.abs(mj - (x + Math.floor(w / 2)))) {
        ms = s; mi = -1; mj = j;
      }
    }
  }

  let nf = [];
  if (h > csize && mi !== -1) {
    const L = [x, y, w, mi - y];
    const R = [x, mi, w, y + h - mi];
    if (notEmpty(im, imgW, L[0], L[1], L[2], L[3])) {
      nf = nf.concat(traceSkeleton(im, imgW, L[0], L[1], L[2], L[3], csize, maxIter - 1));
    }
    if (notEmpty(im, imgW, R[0], R[1], R[2], R[3])) {
      mergeFrags(nf, traceSkeleton(im, imgW, R[0], R[1], R[2], R[3], csize, maxIter - 1), mi, VERTICAL);
    }
  } else if (w > csize && mj !== -1) {
    const L = [x, y, mj - x, h];
    const R = [mj, y, x + w - mj, h];
    if (notEmpty(im, imgW, L[0], L[1], L[2], L[3])) {
      nf = nf.concat(traceSkeleton(im, imgW, L[0], L[1], L[2], L[3], csize, maxIter - 1));
    }
    if (notEmpty(im, imgW, R[0], R[1], R[2], R[3])) {
      mergeFrags(nf, traceSkeleton(im, imgW, R[0], R[1], R[2], R[3], csize, maxIter - 1), mj, HORIZONTAL);
    }
  }

  frags = frags.concat(nf);
  if (mi === -1 && mj === -1) {
    frags = frags.concat(chunkToFrags(im, imgW, x, y, w, h));
  }

  return frags;
}

// ============================================================
// Main entry: image → skeleton SVG
// ============================================================

/**
 * Convert an extracted image (cv.Mat) to SVG using skeletonization.
 * @param {cv.Mat} img - Input image (BGR or RGBA)
 * @param {number} dpi - Dots per inch for physical sizing
 * @param {function} [onStatus] - Status callback
 * @returns {string} SVG content as a string
 */
function skeletonToSvg(img, dpi, onStatus = () => {}) {
  const mmPerPx = 25.4 / dpi;
  const h = img.rows, w = img.cols;

  // Convert to grayscale
  const gray = new cv.Mat();
  if (img.channels() === 1) {
    img.copyTo(gray);
  } else if (img.channels() === 4) {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
  } else {
    cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY);
  }

  // Threshold (Otsu)
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  // Convert to binary array (1/0)
  onStatus("Skeletonizing...");
  const im = new Uint8Array(w * h);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      im[i * w + j] = thresh.ucharAt(i, j) > 128 ? 1 : 0;
    }
  }

  // Zhang-Suen thinning
  thinningZS(im, w, h);

  // Trace skeleton to polylines
  onStatus("Tracing polylines...");
  const polys = traceSkeleton(im, w, 0, 0, w, h, 10, 999);

  // Build SVG
  const widthMm = w * mmPerPx;
  const heightMm = h * mmPerPx;

  let polylines = "";
  for (const poly of polys) {
    if (poly.length < 2) continue;
    const pts = poly.map(([x, y]) => `${x},${y}`).join(" ");
    polylines += `  <polyline points="${pts}" stroke="black" fill="none" stroke-width="1"/>\n`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${heightMm.toFixed(2)}mm" viewBox="0 0 ${w} ${h}">
${polylines}</svg>`;

  gray.delete();
  thresh.delete();

  onStatus(`Found ${polys.length} polylines`);
  return svg;
}
