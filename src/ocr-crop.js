export function containImageRect(box, naturalWidth, naturalHeight) {
  const values = [box?.left, box?.top, box?.width, box?.height, naturalWidth, naturalHeight].map(Number);
  if (values.some(value => !Number.isFinite(value)) || box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height
  };
}

export function pointerToNormalized(point, rect) {
  if (!point || !rect?.width || !rect?.height) return null;
  return {
    x: Math.max(0, Math.min(1, (Number(point.x) - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (Number(point.y) - rect.top) / rect.height))
  };
}

export function normalizedCropToPixels(crop, imageWidth, imageHeight) {
  const width = Math.floor(Number(imageWidth));
  const height = Math.floor(Number(imageHeight));
  if (!crop || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const xRatio = Math.max(0, Math.min(1, Number(crop.x) || 0));
  const yRatio = Math.max(0, Math.min(1, Number(crop.y) || 0));
  const wRatio = Math.max(0, Math.min(1 - xRatio, Number(crop.w) || 0));
  const hRatio = Math.max(0, Math.min(1 - yRatio, Number(crop.h) || 0));
  const x = Math.min(width - 1, Math.floor(xRatio * width));
  const y = Math.min(height - 1, Math.floor(yRatio * height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(wRatio * width))),
    height: Math.max(1, Math.min(height - y, Math.round(hRatio * height)))
  };
}
