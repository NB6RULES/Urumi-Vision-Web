/**
 * app.js — UI logic for Urumi Vision web app.
 * Supports batch upload, drag-and-drop, and camera capture.
 */

let cvReady = false;
let cameraStream = null;

function onOpenCvReady() {
  cvReady = true;
  document.getElementById("status").textContent = "Ready";
  document.getElementById("processBtn").disabled = false;
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("errorMsg").classList.add("hidden");
}

function hideResults() {
  document.getElementById("results").classList.add("hidden");
  document.getElementById("resultsContainer").innerHTML = "";
}

function setBatchProgress(current, total) {
  const bar = document.getElementById("batchProgress");
  bar.classList.remove("hidden");
  document.getElementById("batchLabel").textContent = `Processing image ${current} of ${total}...`;
  document.getElementById("batchCount").textContent = `${current}/${total}`;
  document.getElementById("batchBar").style.width = `${(current / total) * 100}%`;
}

function hideBatchProgress() {
  document.getElementById("batchProgress").classList.add("hidden");
}

// ============================================================
// Convert cv.Mat to PNG Blob
// ============================================================
function matToBlob(mat) {
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, mat);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// ============================================================
// Process a single image, return result HTML
// ============================================================
async function processSingleImage(file, imgMat, index, options) {
  const { dpiOverride, wantExtract, wantContour, wantSkeleton, wantOutline, outerOnly, ignoreEdge } = options;
  const fileName = file ? file.name : `capture_${index + 1}`;
  const baseName = fileName.replace(/\.[^.]+$/, "");

  const card = document.createElement("div");
  card.className = "bg-white rounded-xl shadow-sm border p-5 space-y-4";

  // Title
  const title = document.createElement("h3");
  title.className = "font-semibold text-gray-700 text-lg border-b pb-2";
  title.textContent = fileName;
  card.appendChild(title);

  try {
    // Stage 1: Extract
    setStatus(`[${baseName}] Detecting ArUco frame...`);
    const { imgOut, dpi, frameName } = processImage(imgMat, FRAME_CONFIGS, {
      solveDist: true,
      dpi: dpiOverride,
      onStatus: (msg) => setStatus(`[${baseName}] ${msg}`),
    });

    // Extract result
    if (wantExtract) {
      setStatus(`[${baseName}] Generating PNG...`);
      const blob = await matToBlob(imgOut);
      const url = URL.createObjectURL(blob);
      card.appendChild(makeResultBlock(
        "Stage 1: Extracted PNG",
        `Frame: ${frameName} | DPI: ${dpi} | ${imgOut.cols} x ${imgOut.rows} px`,
        `<img src="${url}" class="max-w-full rounded border max-h-72 mx-auto" />`,
        url, `${baseName}_${dpi}_DPI.png`
      ));
    }

    // Contour SVG
    if (wantContour) {
      setStatus(`[${baseName}] Generating contour SVG...`);
      const svgStr = contourToSvg(imgOut, dpi);
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      card.appendChild(makeResultBlock(
        "Stage 2: Contour SVG", null,
        `<div class="border rounded p-2 bg-white overflow-auto max-h-72">${svgStr}</div>`,
        url, `${baseName}_contour.svg`
      ));
    }

    // Skeleton SVG
    if (wantSkeleton) {
      setStatus(`[${baseName}] Generating skeleton SVG...`);
      await new Promise((r) => setTimeout(r, 50));
      const svgStr = skeletonToSvg(imgOut, dpi, (msg) => setStatus(`[${baseName}] ${msg}`));
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      card.appendChild(makeResultBlock(
        "Stage 2: Skeleton SVG", null,
        `<div class="border rounded p-2 bg-white overflow-auto max-h-72">${svgStr}</div>`,
        url, `${baseName}_skeleton.svg`
      ));
    }

    // Outline SVG
    if (wantOutline) {
      setStatus(`[${baseName}] Generating outline SVG...`);
      const svgStr = outlineToSvg(imgOut, dpi, outerOnly, ignoreEdge);
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      card.appendChild(makeResultBlock(
        `Stage 2: Outline SVG${outerOnly ? " (outer only)" : ""}`, null,
        `<div class="border rounded p-2 bg-white overflow-auto max-h-72">${svgStr}</div>`,
        url, `${baseName}_outline.svg`
      ));
    }

    imgOut.delete();
  } catch (err) {
    const errDiv = document.createElement("div");
    errDiv.className = "bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg";
    errDiv.textContent = `Error: ${err.message || "Processing failed."}`;
    card.appendChild(errDiv);
    console.error(`Error processing ${fileName}:`, err);
  }

  return card;
}

function makeResultBlock(title, subtitle, contentHtml, downloadUrl, downloadName) {
  const block = document.createElement("div");
  block.className = "result-card";

  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-2";

  const left = document.createElement("div");
  const h = document.createElement("h4");
  h.className = "font-medium text-gray-600 text-sm";
  h.textContent = title;
  left.appendChild(h);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "text-xs text-gray-400";
    sub.textContent = subtitle;
    left.appendChild(sub);
  }
  header.appendChild(left);

  const dl = document.createElement("a");
  dl.href = downloadUrl;
  dl.download = downloadName;
  dl.className = "text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap";
  dl.textContent = "Download";
  header.appendChild(dl);

  block.appendChild(header);

  const content = document.createElement("div");
  content.innerHTML = contentHtml;
  block.appendChild(content);

  return block;
}

// ============================================================
// Main entry: batch processing
// ============================================================
async function processUpload() {
  hideError();
  hideResults();
  hideBatchProgress();

  const fileInput = document.getElementById("fileInput");
  const files = Array.from(fileInput.files);

  // Also check for camera-captured images
  if (!files.length && !window._capturedImages?.length) {
    showError("Please select image files or take a photo.");
    return;
  }

  if (!cvReady) {
    showError("OpenCV.js is still loading. Please wait.");
    return;
  }

  const dpiInput = document.getElementById("dpiInput").value;
  const dpiOverride = dpiInput ? parseInt(dpiInput) : null;
  const wantExtract = document.getElementById("chkExtract").checked;
  const wantContour = document.getElementById("chkContour").checked;
  const wantSkeleton = document.getElementById("chkSkeleton").checked;
  const wantOutline = document.getElementById("chkOutline").checked;
  const outerOnly = document.getElementById("chkOuterOnly").checked;
  const ignoreEdge = document.getElementById("chkIgnoreEdge").checked;

  if (!wantExtract && !wantContour && !wantSkeleton && !wantOutline) {
    showError("Select at least one output option.");
    return;
  }

  const options = { dpiOverride, wantExtract, wantContour, wantSkeleton, wantOutline, outerOnly, ignoreEdge };
  const btn = document.getElementById("processBtn");
  btn.disabled = true;

  // Combine file uploads and camera captures
  const jobs = [];
  for (const f of files) {
    jobs.push({ file: f, mat: null });
  }
  if (window._capturedImages) {
    for (const cap of window._capturedImages) {
      jobs.push({ file: null, mat: cap.mat, name: cap.name });
    }
  }

  const total = jobs.length;
  const container = document.getElementById("resultsContainer");
  container.innerHTML = "";
  document.getElementById("results").classList.remove("hidden");

  if (total > 1) setBatchProgress(0, total);

  for (let i = 0; i < jobs.length; i++) {
    if (total > 1) setBatchProgress(i + 1, total);

    let imgMat;
    let fakeFile;

    if (jobs[i].mat) {
      // Camera capture
      imgMat = jobs[i].mat;
      fakeFile = { name: jobs[i].name };
    } else {
      // File upload
      setStatus(`Loading ${jobs[i].file.name}...`);
      imgMat = await loadImageToMat(jobs[i].file);
      fakeFile = jobs[i].file;
    }

    const card = await processSingleImage(fakeFile, imgMat, i, options);
    container.appendChild(card);

    if (!jobs[i].mat) {
      imgMat.delete();
    }
  }

  // Clean up camera captures
  if (window._capturedImages) {
    for (const cap of window._capturedImages) cap.mat.delete();
    window._capturedImages = [];
  }

  hideBatchProgress();
  setStatus(`Done! Processed ${total} image${total > 1 ? "s" : ""}.`);
  btn.disabled = false;
}

// ============================================================
// Load File → cv.Mat
// ============================================================
function loadImageToMat(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const mat = cv.imread(canvas);
        resolve(mat);
      };
      img.onerror = () => reject(new Error("Failed to load image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

// ============================================================
// Camera
// ============================================================
window._capturedImages = [];

async function openCamera() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("cameraVideo");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    video.srcObject = cameraStream;
    modal.classList.remove("hidden");
  } catch (err) {
    showError("Could not access camera: " + err.message);
  }
}

function closeCamera() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("cameraVideo");
  modal.classList.add("hidden");
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  video.srcObject = null;
}

function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  const mat = cv.imread(canvas);
  const idx = window._capturedImages.length + 1;
  window._capturedImages.push({ mat, name: `camera_${idx}.jpg` });

  closeCamera();

  // Update label
  const label = document.getElementById("fileLabel");
  const fileInput = document.getElementById("fileInput");
  const fileCount = fileInput.files.length;
  const camCount = window._capturedImages.length;
  const parts = [];
  if (fileCount) parts.push(`${fileCount} file${fileCount > 1 ? "s" : ""}`);
  if (camCount) parts.push(`${camCount} photo${camCount > 1 ? "s" : ""}`);
  label.textContent = parts.join(" + ") || "Drop images here or click to browse";
}

// ============================================================
// Drag and drop
// ============================================================
function setupDragDrop() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      updateFileName();
    }
  });
  dropZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", updateFileName);
}

function updateFileName() {
  const fileInput = document.getElementById("fileInput");
  const label = document.getElementById("fileLabel");
  const fileCount = fileInput.files.length;
  const camCount = window._capturedImages?.length || 0;

  const parts = [];
  if (fileCount === 1) {
    parts.push(fileInput.files[0].name);
  } else if (fileCount > 1) {
    parts.push(`${fileCount} files`);
  }
  if (camCount) parts.push(`${camCount} photo${camCount > 1 ? "s" : ""}`);

  label.textContent = parts.join(" + ") || "Drop images here or click to browse";
}

document.addEventListener("DOMContentLoaded", setupDragDrop);
