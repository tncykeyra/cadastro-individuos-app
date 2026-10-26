import test from 'node:test';
import assert from 'node:assert/strict';
import { orderQuadrilateral, perspectiveOutputSize } from '../src/ocr-perspective.js';

test('orders skewed document corners consistently', () => {
  const ordered = orderQuadrilateral([
    { x: 200, y: 120 },
    { x: 10, y: 10 },
    { x: 0, y: 100 },
    { x: 210, y: 20 }
  ]);
  assert.deepEqual(ordered, [
    { x: 10, y: 10 },
    { x: 210, y: 20 },
    { x: 200, y: 120 },
    { x: 0, y: 100 }
  ]);
});

test('computes a bounded output size without changing the document proportions', () => {
  const result = perspectiveOutputSize([
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 200 },
    { x: 0, y: 200 }
  ]);
  assert.deepEqual(result, {
    width: 720,
    height: 360,
    points: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 }
    ]
  });
});

test('rejects degenerate corners and extreme crops', () => {
  assert.equal(orderQuadrilateral([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), null);
  assert.equal(perspectiveOutputSize([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 50 }, { x: 0, y: 50 }]), null);
});
