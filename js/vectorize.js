/**
 * vectorize.js — Port of vectorize.py
 * Contour-based image to SVG conversion.
 * Requires OpenCV.js (cv) to be loaded.
 */

/**
 * Convert an extracted image (cv.Mat) to SVG using contour tracing.
 * @param {cv.Mat} img - Input image (BGR or RGBA)
 * @param {number} dpi - Dots per inch for physical sizing
 * @returns {string} SVG content as a string
 */
function contourToSvg(img, dpi) {
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

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

  // Build SVG path data
  let pathData = "";

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const arcLen = cv.arcLength(contour, true);
    const epsilon = 0.0005 * arcLen;

    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, epsilon, true);

    if (approx.rows < 3) {
      approx.delete();
      contour.delete();
      continue;
    }

    // Build path segment
    let segment = `M ${approx.intAt(0, 0)},${approx.intAt(0, 1)} `;
    for (let j = 1; j < approx.rows; j++) {
      segment += `L ${approx.intAt(j, 0)},${approx.intAt(j, 1)} `;
    }
    segment += "Z ";
    pathData += segment;

    approx.delete();
    contour.delete();
  }

  // Compose SVG
  const widthMm = w * mmPerPx;
  const heightMm = h * mmPerPx;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${heightMm.toFixed(2)}mm" viewBox="0 0 ${w} ${h}">
  <path d="${pathData}" fill="black" stroke="none" fill-rule="evenodd"/>
</svg>`;

  gray.delete();
  thresh.delete();
  contours.delete();
  hierarchy.delete();

  return svg;
}

/**
 * Convert an extracted image to SVG using outline (stroke) rendering.
 * @param {cv.Mat} img - Input image (BGR or RGBA)
 * @param {number} dpi - Dots per inch for physical sizing
 * @param {boolean} [outerOnly=false] - If true, only draw outermost contours (skip holes)
 * @returns {string} SVG content as a string
 */
function outlineToSvg(img, dpi, outerOnly = false, ignoreEdge = false) {
  const mmPerPx = 25.4 / dpi;
  const h = img.rows, w = img.cols;

  const gray = new cv.Mat();
  if (img.channels() === 1) {
    img.copyTo(gray);
  } else if (img.channels() === 4) {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
  } else {
    cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY);
  }

  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

  // Find which contour indices are frame-edge contours:
  // either touch the image border OR their bounding box covers >50% of image area
  const imgArea = w * h;
  const edgeIndices = new Set();
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const rect = cv.boundingRect(c);
    const touchesBorder = rect.x <= 2 || rect.y <= 2 ||
        rect.x + rect.width >= w - 3 || rect.y + rect.height >= h - 3;
    const coversImage = (rect.width * rect.height) > imgArea * 0.5;
    if (touchesBorder || coversImage) {
      edgeIndices.add(i);
    }
    c.delete();
  }

  // Build set of "ignored" ancestors — edge contours and all their ancestors
  const ignoredSet = new Set(edgeIndices);

  // For outerOnly: determine effective depth — a contour is "outer" if
  // walking up the parent chain only passes through ignored (edge) contours
  function isOuter(idx) {
    let p = hierarchy.intAt(0, idx * 4 + 3);
    while (p !== -1) {
      if (!ignoredSet.has(p)) return false;
      p = hierarchy.intAt(0, p * 4 + 3);
    }
    return true;
  }

  let paths = "";

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);

    // Skip contours that touch the image edge
    if (ignoreEdge && edgeIndices.has(i)) {
      contour.delete();
      continue;
    }

    // Skip non-outer contours when outerOnly is set
    if (outerOnly && !isOuter(i)) {
      contour.delete();
      continue;
    }

    const arcLen = cv.arcLength(contour, true);
    const epsilon = 0.0005 * arcLen;

    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, epsilon, true);

    if (approx.rows < 3) {
      approx.delete();
      contour.delete();
      continue;
    }

    let d = `M ${approx.intAt(0, 0)},${approx.intAt(0, 1)} `;
    for (let j = 1; j < approx.rows; j++) {
      d += `L ${approx.intAt(j, 0)},${approx.intAt(j, 1)} `;
    }
    d += "Z";
    paths += `  <path d="${d}" fill="none" stroke="black" stroke-width="1"/>\n`;

    approx.delete();
    contour.delete();
  }

  const widthMm = w * mmPerPx;
  const heightMm = h * mmPerPx;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm.toFixed(2)}mm" height="${heightMm.toFixed(2)}mm" viewBox="0 0 ${w} ${h}">
${paths}</svg>`;

  gray.delete();
  thresh.delete();
  contours.delete();
  hierarchy.delete();

  return svg;
}
