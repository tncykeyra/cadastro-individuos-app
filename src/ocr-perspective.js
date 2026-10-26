let openCvPromise = null;
const OPEN_CV_URL = 'https://docs.opencv.org/4.13.0/opencv.js';

function polygonArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

function isConvexQuadrilateral(points) {
  if (!Array.isArray(points) || points.length !== 4) return false;
  let direction = 0;
  for (let index = 0; index < 4; index++) {
    const a = points[index], b = points[(index + 1) % 4], c = points[(index + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || Math.abs(cross) < 0.01) return false;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return true;
}

export function orderQuadrilateral(points) {
  if (!Array.isArray(points) || points.length !== 4) return null;
  const normalized = points.map(point => ({ x: Number(point?.x), y: Number(point?.y) }));
  if (normalized.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const center = normalized.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const ordered = normalized
    .map(point => ({ ...point, angle: Math.atan2(point.y - center.y, point.x - center.x) }))
    .sort((a, b) => a.angle - b.angle)
    .map(({ x, y }) => ({ x, y }));
  let start = 0;
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].x + ordered[index].y < ordered[start].x + ordered[start].y) start = index;
  }
  const rotated = ordered.map((_, index) => ordered[(start + index) % 4]);
  if (!isConvexQuadrilateral(rotated) || polygonArea(rotated) < 4) return null;
  return rotated;
}

export function perspectiveOutputSize(points, maxDimension = 1800) {
  const ordered = orderQuadrilateral(points);
  if (!ordered) return null;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const width = Math.max(distance(ordered[0], ordered[1]), distance(ordered[3], ordered[2]));
  const height = Math.max(distance(ordered[0], ordered[3]), distance(ordered[1], ordered[2]));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 80 || height < 50) return null;
  const ratio = width / height;
  if (ratio < 0.38 || ratio > 2.7) return null;
  const scale = Math.min(1.8, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), points: ordered };
}

async function loadOpenCv(timeoutMs = 9000) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (!openCvPromise) {
    openCvPromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-ocr-opencv]');
      let settled = false;
      let readyPromise = null;
      let pollTimer;
      const timeout = setTimeout(() => finish(new Error('OpenCV não ficou pronto a tempo.')), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(pollTimer);
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          if (script?.dataset?.ocrOpencv && !window.cv?.Mat) script.remove();
          reject(error);
        } else resolve(value);
      };
      const inspect = () => {
        const current = window.cv;
        if (current?.then && !readyPromise) {
          readyPromise = Promise.resolve(current).then(value => {
            if (value?.Mat && value?.findContours) finish(null, value);
            else finish(new Error('OpenCV não inicializou corretamente.'));
          }, error => finish(error));
        } else if (current?.Mat && current?.findContours) finish(null, current);
      };
      if (!script) {
        script = document.createElement('script');
        script.src = OPEN_CV_URL;
        script.async = true;
        script.dataset.ocrOpencv = 'true';
        script.addEventListener('error', () => finish(new Error('OpenCV não pôde ser carregado.')), { once: true });
        document.head.append(script);
      }
      script.addEventListener('load', inspect, { once: true });
      pollTimer = setInterval(inspect, 120);
      inspect();
    }).catch(error => {
      openCvPromise = null;
      throw error;
    });
  }
  return openCvPromise;
}

function canvasToJpeg(canvas, quality = 0.94) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || !blob.size) reject(new Error('OpenCV não gerou uma imagem válida.'));
    else resolve(blob);
  }, 'image/jpeg', quality));
}

export async function correctDocumentPerspective(blob, { onProgress = () => {} } = {}) {
  const cv = await loadOpenCv();
  if (!cv) return null;
  let bitmap, src, gray, blurred, edges, closed, kernel, contours, hierarchy, transform, sourcePoints, destinationPoints, warped;
  let inputCanvas, outputCanvas;
  try {
    try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch { bitmap = await createImageBitmap(blob); }
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const inputWidth = Math.max(1, Math.round(bitmap.width * scale));
    const inputHeight = Math.max(1, Math.round(bitmap.height * scale));
    inputCanvas = document.createElement('canvas');
    inputCanvas.width = inputWidth; inputCanvas.height = inputHeight;
    const inputContext = inputCanvas.getContext('2d', { alpha: false });
    if (!inputContext) return null;
    inputContext.drawImage(bitmap, 0, 0, inputWidth, inputHeight);

    onProgress('Detectando bordas para corrigir a perspectiva…');
    src = cv.imread(inputCanvas);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    closed = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 140);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = inputWidth * inputHeight;
    const candidates = [];
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      let approximation;
      try {
        const area = Math.abs(cv.contourArea(contour));
        if (area < imageArea * 0.12 || area > imageArea * 0.92) continue;
        const perimeter = cv.arcLength(contour, true);
        approximation = new cv.Mat();
        cv.approxPolyDP(contour, approximation, 0.02 * perimeter, true);
        if (approximation.rows !== 4) continue;
        const coordinates = approximation.data32S;
        const points = [];
        for (let point = 0; point < 4; point++) points.push({ x: coordinates[point * 2], y: coordinates[point * 2 + 1] });
        const ordered = orderQuadrilateral(points);
        if (!ordered) continue;
        const size = perspectiveOutputSize(ordered);
        if (!size) continue;
        candidates.push({ area, ordered, size });
      } catch { /* um contorno inválido não impede os demais */ }
      finally {
        approximation?.delete();
        contour.delete();
      }
    }
    candidates.sort((a, b) => b.area - a.area);
    const candidate = candidates[0];
    if (!candidate) return null;

    const flattenedSource = candidate.ordered.flatMap(point => [point.x, point.y]);
    const flattenedDestination = [
      0, 0,
      candidate.size.width - 1, 0,
      candidate.size.width - 1, candidate.size.height - 1,
      0, candidate.size.height - 1
    ];
    sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, flattenedSource);
    destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, flattenedDestination);
    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);
    warped = new cv.Mat();
    cv.warpPerspective(src, warped, transform, new cv.Size(candidate.size.width, candidate.size.height), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

    outputCanvas = document.createElement('canvas');
    outputCanvas.width = candidate.size.width; outputCanvas.height = candidate.size.height;
    cv.imshow(outputCanvas, warped);
    const correctedBlob = await canvasToJpeg(outputCanvas);
    return { blob: correctedBlob, areaRatio: candidate.area / imageArea };
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
    for (const mat of [warped, transform, sourcePoints, destinationPoints, hierarchy, contours, kernel, closed, edges, blurred, gray, src]) {
      try { mat?.delete?.(); } catch {}
    }
    if (inputCanvas) { inputCanvas.width = 0; inputCanvas.height = 0; }
    if (outputCanvas) { outputCanvas.width = 0; outputCanvas.height = 0; }
  }
}
