import test from 'node:test';
import assert from 'node:assert/strict';
import { containImageRect, normalizedCropToPixels, pointerToNormalized } from '../src/ocr-crop.js';

test('maps a contain-fitted image to its actual content rectangle, excluding letterbox margins', () => {
  const rect = containImageRect({ left: 10, top: 20, width: 300, height: 300 }, 600, 300);
  assert.deepEqual(rect, { left: 10, top: 95, width: 300, height: 150 });
  assert.deepEqual(pointerToNormalized({ x: 160, y: 20 }, rect), { x: 0.5, y: 0 });
  assert.deepEqual(pointerToNormalized({ x: 160, y: 170 }, rect), { x: 0.5, y: 0.5 });
});

test('clamps pointer positions and crop bounds to the source image', () => {
  const rect = containImageRect({ left: 0, top: 0, width: 200, height: 400 }, 400, 200);
  assert.deepEqual(pointerToNormalized({ x: -20, y: 500 }, rect), { x: 0, y: 1 });
  assert.deepEqual(normalizedCropToPixels({ x: 0.8, y: 0.75, w: 0.5, h: 0.5 }, 1000, 400), {
    x: 800, y: 300, width: 200, height: 100
  });
});

test('rejects unusable image sizes and maps a selected rectangle without spilling past edges', () => {
  assert.equal(containImageRect({ left: 0, top: 0, width: 0, height: 20 }, 100, 100), null);
  assert.equal(normalizedCropToPixels({ x: 0, y: 0, w: 1, h: 1 }, 0, 100), null);
  assert.deepEqual(normalizedCropToPixels({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 100, 200), {
    x: 10, y: 40, width: 30, height: 80
  });
});
