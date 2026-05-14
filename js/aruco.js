/**
 * aruco.js — Pure JS ArUco 4x4_50 marker detection.
 * Uses only basic OpenCV.js operations (findContours, getPerspectiveTransform, warpPerspective).
 * Replaces cv.aruco.detectMarkers which may not be in the CDN build.
 */

// DICT_4X4_50: each marker is 4x4 bits, packed into a 16-bit integer.
// Bit order: row0[col0..col3], row1[col0..col3], ..., row3[col0..col3], MSB first.
const DICT_4X4_50 = [
  0xB532, 0x0F9A, 0x332D, 0x9946, 0x549E, 0x79CD, 0x9E2E, 0xC4F2,
  0xFEDA, 0xCF56, 0xF991, 0x11A7, 0x0EB7, 0x2A0F, 0x24B1, 0x263E,
  0x4665, 0x6600, 0x6C5E, 0x76AF, 0x868B, 0xB02B, 0xCCD5, 0xDD82,
  0xFE47, 0x9471, 0xACE4, 0xA554, 0x2123, 0x346F, 0x4415, 0x57B2,
  0x9ECF, 0xF0CB, 0x08AE, 0x0929, 0x1875, 0x04FF, 0x0DF6, 0x1C5A,
  0x1718, 0x2A28, 0x328C, 0x38B2, 0x24E8, 0x2EEB, 0x2D3F, 0x4B64,
  0x502E, 0x5013,
];

/**
 * Generate the 4x4 bit grid for a dictionary entry.
 * Returns a 4x4 array of 0/1.
 */
function dictEntryToGrid(id) {
  if (id >= DICT_4X4_50.length) return null;
  const bits = DICT_4X4_50[id];
  const grid = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 4; c++) {
      row.push((bits >> (15 - (r * 4 + c))) & 1);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Build lookup table: grid-hash → {id, rotation}
 */
function buildDictLookup() {
  const lookup = {};
  for (let id = 0; id < DICT_4X4_50.length; id++) {
    let grid = dictEntryToGrid(id);
    for (let rot = 0; rot < 4; rot++) {
      const key = gridToKey(grid);
      lookup[key] = { id, rotation: rot };
      grid = rotateGrid90(grid);
    }
  }
  return lookup;
}

function gridToKey(grid) {
  let key = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      key = (key << 1) | grid[r][c];
    }
  }
  return key;
}

function rotateGrid90(grid) {
  const n = grid.length;
  const rotated = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      row.push(grid[n - 1 - c][r]);
    }
    rotated.push(row);
  }
  return rotated;
}

const DICT_LOOKUP = buildDictLookup();

/**
 * Order 4 corner points consistently: top-left, top-right, bottom-right, bottom-left.
 */
function orderCorners(pts) {
  // Sort by y, then x
  const sorted = pts.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottom = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL
}

/**
 * Detect ArUco markers using basic OpenCV.js operations.
 * @param {cv.Mat} img - Input image (RGBA or BGR)
 * @returns {Object} Map of marker ID → [[x,y],[x,y],[x,y],[x,y]] (4 corners)
 */
function detectArucoMarkers(img) {
  const gray = new cv.Mat();
  if (img.channels() === 4) {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
  } else if (img.channels() === 3) {
    cv.cvtColor(img, gray, cv.COLOR_BGR2GRAY);
  } else {
    img.copyTo(gray);
  }

  // Adaptive threshold to find black/white patterns
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, Math.max(3, Math.round(gray.cols / 40) | 1), 7);

  // Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const markers = {};
  const imgArea = gray.rows * gray.cols;

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const peri = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.04 * peri, true);

    // Must be a quadrilateral
    if (approx.rows !== 4) {
      approx.delete();
      contour.delete();
      continue;
    }

    // Filter by area
    const area = Math.abs(cv.contourArea(approx));
    if (area < imgArea * 0.0005 || area > imgArea * 0.1) {
      approx.delete();
      contour.delete();
      continue;
    }

    // Must be convex
    if (!cv.isContourConvex(approx)) {
      approx.delete();
      contour.delete();
      continue;
    }

    // Extract 4 corners
    const corners = [];
    for (let j = 0; j < 4; j++) {
      corners.push([approx.intAt(j, 0), approx.intAt(j, 1)]);
    }
    const ordered = orderCorners(corners);

    // Perspective warp to 6x6 grid (4x4 data + 1px border)
    const cellSize = 10;
    const gridSize = 6 * cellSize;

    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2,
      ordered.flat());
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2,
      [0, 0, gridSize, 0, gridSize, gridSize, 0, gridSize]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    const dsize = new cv.Size(gridSize, gridSize);
    cv.warpPerspective(gray, warped, M, dsize);

    // Threshold the warped image
    const warpThresh = new cv.Mat();
    cv.threshold(warped, warpThresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

    // Check border is black (all 0s)
    let borderOk = true;
    for (let rc = 0; rc < 6 && borderOk; rc++) {
      for (let cc = 0; cc < 6 && borderOk; cc++) {
        if (rc > 0 && rc < 5 && cc > 0 && cc < 5) continue; // skip inner
        const cx = Math.floor((cc + 0.5) * cellSize);
        const cy = Math.floor((rc + 0.5) * cellSize);
        if (warpThresh.ucharAt(cy, cx) > 128) {
          borderOk = false;
        }
      }
    }

    if (!borderOk) {
      srcPts.delete(); dstPts.delete(); M.delete(); warped.delete(); warpThresh.delete();
      approx.delete(); contour.delete();
      continue;
    }

    // Read 4x4 inner grid
    const grid = [];
    for (let r = 0; r < 4; r++) {
      const row = [];
      for (let c = 0; c < 4; c++) {
        const cx = Math.floor((c + 1 + 0.5) * cellSize);
        const cy = Math.floor((r + 1 + 0.5) * cellSize);
        // Sample a small region around center
        let sum = 0, count = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const py = Math.max(0, Math.min(gridSize - 1, cy + dy));
            const px = Math.max(0, Math.min(gridSize - 1, cx + dx));
            sum += warpThresh.ucharAt(py, px);
            count++;
          }
        }
        row.push(sum / count > 128 ? 1 : 0);
      }
      grid.push(row);
    }

    // Look up in dictionary
    const key = gridToKey(grid);
    const match = DICT_LOOKUP[key];

    if (match) {
      // Rotate corners back to match the canonical orientation
      let finalCorners = ordered.slice();
      for (let r = 0; r < match.rotation; r++) {
        finalCorners = [finalCorners[3], finalCorners[0], finalCorners[1], finalCorners[2]];
      }
      markers[match.id] = finalCorners;
    }

    srcPts.delete(); dstPts.delete(); M.delete(); warped.delete(); warpThresh.delete();
    approx.delete(); contour.delete();
  }

  contours.delete();
  hierarchy.delete();
  gray.delete();
  thresh.delete();

  return markers;
}
