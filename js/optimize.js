/**
 * Nelder-Mead simplex optimizer.
 * Replaces scipy.optimize.minimize for the lens distortion problem.
 *
 * @param {function} fn - Objective function: (x: number[]) => number
 * @param {number[]} x0 - Initial guess
 * @param {number} [maxIter=400] - Maximum iterations
 * @param {number} [tol=1e-8] - Convergence tolerance on function value spread
 * @returns {{x: number[], fval: number}}
 */
function nelderMead(fn, x0, maxIter = 400, tol = 1e-8) {
  const n = x0.length;
  const alpha = 1.0, gamma = 2.0, rho = 0.5, sigma = 0.5;

  // Build initial simplex
  let simplex = [];
  for (let i = 0; i <= n; i++) {
    let pt = x0.slice();
    if (i > 0) {
      pt[i - 1] += (Math.abs(pt[i - 1]) > 1e-10 ? pt[i - 1] * 0.05 : 0.00025);
    }
    simplex.push({ x: pt, f: fn(pt) });
  }

  for (let iter = 0; iter < maxIter; iter++) {
    // Sort by function value
    simplex.sort((a, b) => a.f - b.f);

    // Check convergence
    if (Math.abs(simplex[n].f - simplex[0].f) < tol) break;

    // Centroid of all points except worst
    let centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j];
    }
    for (let j = 0; j < n; j++) centroid[j] /= n;

    // Reflection
    let xr = centroid.map((c, j) => c + alpha * (c - simplex[n].x[j]));
    let fr = fn(xr);

    if (fr < simplex[0].f) {
      // Expansion
      let xe = centroid.map((c, j) => c + gamma * (xr[j] - c));
      let fe = fn(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr };
    } else {
      // Contraction
      let xc = centroid.map((c, j) => c + rho * (simplex[n].x[j] - c));
      let fc = fn(xc);
      if (fc < simplex[n].f) {
        simplex[n] = { x: xc, f: fc };
      } else {
        // Shrink
        for (let i = 1; i <= n; i++) {
          simplex[i].x = simplex[i].x.map((v, j) => simplex[0].x[j] + sigma * (v - simplex[0].x[j]));
          simplex[i].f = fn(simplex[i].x);
        }
      }
    }
  }

  simplex.sort((a, b) => a.f - b.f);
  return { x: simplex[0].x, fval: simplex[0].f };
}
