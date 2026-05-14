/**
 * extract.js — Port of extract.py + utils/misc.py + utils/solve_lens.py
 * ArUco frame detection, perspective correction, lens distortion solving.
 * Requires OpenCV.js (cv) and optimize.js (nelderMead) to be loaded.
 */

// ============================================================
// Linear algebra helpers (replaces numpy.linalg)
// ============================================================

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting.
 * A is n×n, b is n×1. Returns x as array of length n.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  // Build augmented matrix
  let M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) continue;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }

  // Back substitution
  let x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/**
 * Solve overdetermined Ax = b via normal equations: A^T A x = A^T b
 */
function solveLeastSquares(A, b) {
  const m = A.length, n = A[0].length;
  // A^T A (n×n)
  let AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  // A^T b (n×1)
  let Atb = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += A[k][i] * A[k][j];
      AtA[i][j] = s;
    }
    let s = 0;
    for (let k = 0; k < m; k++) s += A[k][i] * b[k];
    Atb[i] = s;
  }

  return solveLinearSystem(AtA, Atb);
}

// ============================================================
// Port of utils/misc.py: solve_affine
// ============================================================

/**
 * Solve projective (homography) transform from xy (mm) to uv (pixels).
 * @param {number[][]} xyArray - Nx2 array of mm coordinates
 * @param {number[][]} uvArray - Nx2 array of pixel coordinates
 * @returns {number[][]} 3x3 projection matrix (row-major)
 */
function solveAffine(xyArray, uvArray) {
  const nPoints = xyArray.length;
  let A = [];
  let b = [];

  for (let i = 0; i < nPoints; i++) {
    const [x, y] = xyArray[i];
    const [u, v] = uvArray[i];

    // Row for u
    let row1 = [x, y, 1, 0, 0, 0, -x * u, -y * u];
    A.push(row1);
    b.push(u);

    // Row for v
    let row2 = [0, 0, 0, x, y, 1, -x * v, -y * v];
    A.push(row2);
    b.push(v);
  }

  let sol8;
  if (nPoints === 4) {
    sol8 = solveLinearSystem(A, b);
  } else {
    sol8 = solveLeastSquares(A, b);
  }

  // Build 3x3 matrix, sol[8] = 1
  return [
    [sol8[0], sol8[1], sol8[2]],
    [sol8[3], sol8[4], sol8[5]],
    [sol8[6], sol8[7], 1],
  ];
}

/**
 * Apply 3x3 projective transform to Nx2 points.
 * @param {number[][]} proj - 3x3 matrix
 * @param {number[][]} xy - Nx2 points
 * @returns {number[][]} Nx2 transformed points
 */
function applyAffine(proj, xy) {
  return xy.map(([x, y]) => {
    const w = proj[2][0] * x + proj[2][1] * y + proj[2][2];
    const u = (proj[0][0] * x + proj[0][1] * y + proj[0][2]) / w;
    const v = (proj[1][0] * x + proj[1][1] * y + proj[1][2]) / w;
    return [u, v];
  });
}

/**
 * Invert a 3x3 matrix.
 */
function invert3x3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const invDet = 1 / det;
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

// ============================================================
// Port of utils/solve_lens.py
// ============================================================

function undistort(params, uv, f) {
  const [k1, k2, uc, vc] = params;
  return uv.map(([u, v]) => {
    const du = (u - uc) / f;
    const dv = (v - vc) / f;
    const r2 = du * du + dv * dv;
    const coeff = 1 / (1 + k1 * r2 + k2 * r2 * r2);
    return [uc + (u - uc) * coeff, vc + (v - vc) * coeff];
  });
}

function xyError(xy, uv, proj) {
  const pInv = invert3x3(proj);
  const s = pInv[2][2];
  // Normalize so pInv[2][2] = 1
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      pInv[i][j] /= s;

  return xy.map(([xExpected, yExpected], idx) => {
    const [u, v] = uv[idx];
    const w = pInv[2][0] * u + pInv[2][1] * v + pInv[2][2];
    const xCalc = (pInv[0][0] * u + pInv[0][1] * v + pInv[0][2]) / w;
    const yCalc = (pInv[1][0] * u + pInv[1][1] * v + pInv[1][2]) / w;
    return [xCalc - xExpected, yCalc - yExpected];
  });
}

function xyLoss(params, xy, uv, proj, f) {
  const uvU = undistort(params, uv, f);
  const err = xyError(xy, uvU, proj);
  let sum = 0;
  for (const [ex, ey] of err) sum += ex * ex + ey * ey;
  return sum / err.length;
}

function solveDistortion(xy, uv, proj, f, w, h) {
  const x0 = [0, 0, w / 2, h / 2];
  const result = nelderMead((p) => xyLoss(p, xy, uv, proj, f), x0);
  return result.x;
}

// ============================================================
// Port of extract.py: ArUco detection + image extraction
// ============================================================

/**
 * Detect ArUco markers in an OpenCV Mat.
 * Uses pure JS detection from aruco.js (no cv.aruco dependency).
 * @param {cv.Mat} img - BGR/RGBA image
 * @returns {Object} Map of marker ID → [[x,y],...] (4 corners)
 */
function findAruco(img) {
  return detectArucoMarkers(img);
}

/**
 * Identify which frame config matches the detected markers.
 */
function identifyFrame(img, configFrames) {
  const cornersDict = findAruco(img);

  for (const name in configFrames) {
    const config = configFrames[name];
    let match = true;
    for (const arucoId of config.aruco_id) {
      if (!(arucoId in cornersDict)) {
        match = false;
        break;
      }
    }
    if (match) return { name, cornersDict };
  }
  return { name: null, cornersDict };
}

/**
 * Get ArUco feature positions (centers of detected markers).
 */
function getArucoFeatures(cornersDict, config) {
  const xyArray = [];
  const uvArray = [];

  for (let i = 0; i < 4; i++) {
    xyArray.push(config.aruco_pos[i].slice());
    const corners = cornersDict[config.aruco_id[i]];
    // Center of 4 corners
    let cx = 0, cy = 0;
    for (const [x, y] of corners) { cx += x; cy += y; }
    uvArray.push([cx / 4, cy / 4]);
  }

  return { xyArray, uvArray };
}

/**
 * Compute DPI from ArUco positions.
 */
function getDotsPerMm(xy, uv) {
  let maxRatio = 0;
  for (let i = -1; i < 3; i++) {
    const i0 = (i + 4) % 4;
    const i1 = (i + 1 + 4) % 4;
    const dxy = Math.hypot(xy[i1][0] - xy[i0][0], xy[i1][1] - xy[i0][1]);
    const duv = Math.hypot(uv[i1][0] - uv[i0][0], uv[i1][1] - uv[i0][1]);
    maxRatio = Math.max(maxRatio, duv / dxy);
  }
  return maxRatio;
}

/**
 * Get corner features with sub-pixel refinement.
 */
function getCornerFeatures(imgGray, proj, config) {
  const xyFeats = [];
  const uvFeatsApprox = [];

  for (const edge of config.corner_pos) {
    for (const pt of edge) {
      xyFeats.push(pt.slice());
    }
  }

  // Project xy to uv using initial affine
  const uvProjected = applyAffine(proj, xyFeats);
  for (const uv of uvProjected) uvFeatsApprox.push(uv);

  const nPoints = xyFeats.length;

  // Compute search window size
  const searchMm = 0.7 * config.corner_size / 2;
  const crossXy = [];
  for (let i = 0; i < nPoints; i++) {
    crossXy.push([xyFeats[i][0] - searchMm, xyFeats[i][1]]);
    crossXy.push([xyFeats[i][0] + searchMm, xyFeats[i][1]]);
    crossXy.push([xyFeats[i][0], xyFeats[i][1] - searchMm]);
    crossXy.push([xyFeats[i][0], xyFeats[i][1] + searchMm]);
  }
  const crossUv = applyAffine(proj, crossXy);

  // Compute average span
  let sumSpanX = 0, sumSpanY = 0;
  for (let i = 0; i < nPoints; i++) {
    const pts = crossUv.slice(i * 4, i * 4 + 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    sumSpanX += (maxX - minX) / 2;
    sumSpanY += (maxY - minY) / 2;
  }
  const searchW = Math.round(sumSpanX / nPoints);
  const searchH = Math.round(sumSpanY / nPoints);

  // cornerSubPix for sub-pixel refinement
  let uvFeats;
  try {
    const cornersMat = cv.matFromArray(nPoints, 1, cv.CV_32FC2,
      uvFeatsApprox.flatMap(([x, y]) => [x, y]));

    const winSize = new cv.Size(Math.max(1, searchW), Math.max(1, searchH));
    const zeroZone = new cv.Size(-1, -1);
    const criteria = new cv.TermCriteria(cv.TERM_CRITERIA_COUNT + cv.TERM_CRITERIA_EPS, 40, 0.001);

    cv.cornerSubPix(imgGray, cornersMat, winSize, zeroZone, criteria);

    uvFeats = [];
    for (let i = 0; i < nPoints; i++) {
      uvFeats.push([cornersMat.floatAt(i, 0), cornersMat.floatAt(i, 1)]);
    }
    cornersMat.delete();
  } catch (e) {
    // Fallback: use approximate positions without sub-pixel refinement
    console.warn("cornerSubPix not available, using approximate positions", e);
    uvFeats = uvFeatsApprox.slice();
  }

  return { xyFeats, uvFeats };
}

/**
 * Extract the content region using perspective warp + optional distortion correction.
 * Uses pure JS distortion math (no cv.undistortPoints dependency).
 */
function extractImageBatch(img, proj, config, dotsPerMm, distParams) {
  const h = img.rows, w = img.cols;

  const m = config.margins.inner_content;
  const xmin = m, xmax = config.width - m;
  const ymin = m, ymax = config.height - m;

  const hOut = Math.floor(dotsPerMm * (ymax - ymin));
  const wOut = Math.floor(dotsPerMm * (xmax - xmin));

  // Build the mm coordinate grid and project to pixels
  const totalPts = hOut * wOut;
  const map1Data = new Float32Array(totalPts);
  const map2Data = new Float32Array(totalPts);

  let idx = 0;
  for (let row = 0; row < hOut; row++) {
    const yMm = ymax - (row / (hOut - 1)) * (ymax - ymin);
    for (let col = 0; col < wOut; col++) {
      const xMm = xmin + (col / (wOut - 1)) * (xmax - xmin);
      const pw = proj[2][0] * xMm + proj[2][1] * yMm + proj[2][2];
      map1Data[idx] = (proj[0][0] * xMm + proj[0][1] * yMm + proj[0][2]) / pw;
      map2Data[idx] = (proj[1][0] * xMm + proj[1][1] * yMm + proj[1][2]) / pw;
      idx++;
    }
  }

  // Pure JS distortion correction (matches Python's cv2.undistortPoints behavior)
  if (distParams) {
    const [k1, k2, uc, vc] = distParams;
    const f = w;
    for (let i = 0; i < totalPts; i++) {
      const u = map1Data[i], v = map2Data[i];
      const du = (u - uc) / f;
      const dv = (v - vc) / f;
      const r2 = du * du + dv * dv;
      const coeff = 1 + k1 * r2 + k2 * r2 * r2;
      map1Data[i] = uc + (u - uc) * coeff;
      map2Data[i] = vc + (v - vc) * coeff;
    }
  }

  const map1 = cv.matFromArray(hOut, wOut, cv.CV_32FC1, map1Data);
  const map2 = cv.matFromArray(hOut, wOut, cv.CV_32FC1, map2Data);

  const imgOut = new cv.Mat();
  cv.remap(img, imgOut, map1, map2, cv.INTER_CUBIC);

  map1.delete();
  map2.delete();

  return imgOut;
}

// ============================================================
// Main processing pipeline
// ============================================================

/**
 * Process an image containing an ArUco frame.
 * @param {cv.Mat} img - Input BGR image
 * @param {Object} configFrames - FRAME_CONFIGS object
 * @param {Object} [options]
 * @param {boolean} [options.solveDist=true] - Solve lens distortion
 * @param {number|null} [options.dpi=null] - Manual DPI override
 * @param {function} [options.onStatus] - Status callback: (message) => void
 * @returns {{imgOut: cv.Mat, dpi: number, frameName: string}} - Caller must delete imgOut
 */
function processImage(img, configFrames, options = {}) {
  const { solveDist = true, dpi: dpiOverride = null, onStatus = () => {} } = options;

  const h = img.rows, w = img.cols;

  // Convert to grayscale
  const imgGray = new cv.Mat();
  if (img.channels() === 1) {
    img.copyTo(imgGray);
  } else {
    cv.cvtColor(img, imgGray, cv.COLOR_RGBA2GRAY);
  }

  // Detect frame
  onStatus("Detecting ArUco markers...");
  const { name: frameName, cornersDict } = identifyFrame(img, configFrames);

  if (!frameName) {
    imgGray.delete();
    throw new Error("No ArUco frame detected in the image.");
  }

  onStatus(`Frame detected: ${frameName}`);
  const config = configFrames[frameName];

  // Get ArUco features
  const { xyArray: xyA, uvArray: uvA } = getArucoFeatures(cornersDict, config);
  let proj = solveAffine(xyA, uvA);

  // Compute DPI
  let dpi = dpiOverride;
  if (dpi === null) {
    dpi = Math.round(getDotsPerMm(xyA, uvA) * 25.4);
  }
  const dotsPerMm = dpi / 25.4;
  onStatus(`DPI: ${dpi}`);

  // Get corner features (sub-pixel refinement)
  onStatus("Refining corner features...");
  const { xyFeats: xyC, uvFeats: uvC } = getCornerFeatures(imgGray, proj, config);
  let projFine = solveAffine(xyC, uvC);

  let distParams = null;

  if (solveDist) {
    onStatus("Solving lens distortion...");
    distParams = solveDistortion(xyC, uvC, projFine, w, w, h);

    // Iterative refinement (4 passes like Python)
    for (let i = 0; i < 4; i++) {
      const uvU = undistort(distParams, uvC, w);
      projFine = solveAffine(xyC, uvU);
      distParams = solveDistortion(xyC, uvC, projFine, w, w, h);
    }
  }

  // Extract image
  onStatus("Extracting image...");
  const imgOut = extractImageBatch(img, projFine, config, dotsPerMm, distParams);

  // Handle upside-down case
  if (uvA[0][1] < uvA[2][1]) {
    cv.rotate(imgOut, imgOut, cv.ROTATE_180);
  }

  imgGray.delete();

  return { imgOut, dpi, frameName };
}
