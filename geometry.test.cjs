'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./geometry.js');
const square = (id, height, lo, hi, smooth = 0) => ({ id, height, closed: true, smooth, points: [
  { x: lo, y: lo }, { x: hi, y: lo }, { x: hi, y: hi }, { x: lo, y: hi }
] });
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≉ ${b}`);

test('nested contours create exact boundaries, a graded annulus, and an inner plateau', () => {
  const contours = [square('outer', 10, 0.1, 0.9), square('inner', 30, 0.3, 0.7)];
  assert.deepEqual(core.validate(contours, []), []);
  const p = core.prepare(contours, [], -10);
  near(p.sample(0, 0.5), -10);
  near(p.sample(0.1, 0.5), 10);
  near(p.sample(0.2, 0.5), 20);
  near(p.sample(0.3, 0.5), 30);
  near(p.sample(0.5, 0.5), 30);
  near(p.sample(0.05, 0.5), 0);
});

test('negative elevations and a summit pin are exact and interpolate locally', () => {
  const contours = [square('basin', -40, 0.1, 0.9)];
  const pins = [{ id: 'floor', x: 0.5, y: 0.5, height: -80 }];
  const p = core.prepare(contours, pins, -20);
  near(p.sample(0.5, 0.5), -80);
  near(p.sample(0.1, 0.5), -40);
  near(p.sample(0.3, 0.5), -60);
  assert.ok(p.sample(0.25, 0.5) < -40 && p.sample(0.25, 0.5) > -80);
});

test('rejects self crossing, different-height crossing/touch, and contradictory pins', () => {
  const bow = { id: 'bow', height: 10, closed: true, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.2 }] };
  assert.ok(core.validate([bow], []).some(i => i.ids.includes('bow') && i.message.includes('自分')));
  const a = square('a', 10, 0.1, 0.6), b = square('b', 20, 0.4, 0.9);
  assert.ok(core.validate([a, b], []).some(i => i.ids.includes('a') && i.ids.includes('b')));
  const touch = { id: 'touch', height: 20, closed: false, points: [{ x: 0.6, y: 0.4 }, { x: 0.9, y: 0.4 }] };
  assert.ok(core.validate([a, touch], []).length);
  assert.ok(core.validate([a], [{ id: 'pin', x: 0.1, y: 0.3, height: 12 }]).some(i => i.ids.includes('pin')));
  assert.ok(core.validate([], [{ id: 'p1', x: 0.5, y: 0.5, height: 1 }, { id: 'p2', x: 0.5, y: 0.5, height: 2 }]).length);
  assert.throws(() => core.prepare([a, b], [], 0), error => Array.isArray(error.issues));
});

test('same-height touching and valid adjacent vertices are accepted', () => {
  const a = square('a', 10, 0.1, 0.6);
  const touch = { id: 'touch', height: 10, closed: false, points: [{ x: 0.6, y: 0.4 }, { x: 0.9, y: 0.4 }] };
  assert.deepEqual(core.validate([a, touch], []), []);
  const reversed = { ...a, points: a.points.slice().reverse() };
  near(core.prepare([reversed], [], 0).sample(0.3, 0.3), 10);
});

test('display curve vertices are exactly the sampled elevation constraints', () => {
  const contour = square('smooth', 17, 0.25, 0.75, 0.8);
  const points = core.curvePoints(contour), p = core.prepare([contour], [], 0);
  assert.ok(points.length > 16 && points.length < 512);
  assert.deepEqual(points[0], contour.points[0]);
  assert.ok(!points.every(point => contour.points.some(q => q.x === point.x && q.y === point.y)));
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    near(p.sample((a.x + b.x) / 2, (a.y + b.y) / 2), 17);
  }
});

test('simplification preserves endpoints and a meaningful bend', () => {
  const points = [{ x: 0, y: 0 }, { x: 0.2, y: 0.001 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }];
  assert.deepEqual(core.simplify(points, 0.01), [points[0], points[2], points[3], points[4]]);
});

test('image mapping preserves north-up Unity x/z bounds within a crop frame', () => {
  const frame = { u0: 0.2, v0: 0.1, u1: 0.8, v1: 0.9 }, bounds = { xMin: -100, xMax: 300, zMin: -50, zMax: 150 };
  assert.deepEqual(core.imageToWorld({ x: 0.2, y: 0.1 }, frame, bounds), { x: -100, z: 150 });
  assert.deepEqual(core.imageToWorld({ x: 0.8, y: 0.9 }, frame, bounds), { x: 300, z: -50 });
  const center = core.imageToWorld({ x: 0.5, y: 0.5 }, frame, bounds);
  near(center.x, 100); near(center.z, 50);
});

test('grid samples frame endpoints with rows north to south; RAW is clamped little-endian', () => {
  const frame = { u0: 0.1, v0: 0.2, u1: 0.9, v1: 0.8 };
  const grid = core.sampleGrid({ sample: (u, v) => u + 10 * v }, frame, 2);
  assert.ok(grid instanceof Float64Array);
  assert.deepEqual(Array.from(grid), [2.1, 2.9, 8.1, 8.9]);
  const bytes = core.encodeRaw16(new Float64Array([-11, -10, 0, 10, 11]), -10, 10);
  assert.deepEqual(Array.from(bytes), [0, 0, 0, 0, 0, 128, 255, 255, 255, 255]);
  const oriented = core.encodeRaw16(core.sampleGrid((u, v) => v, { u0: 0, v0: 0, u1: 1, v1: 1 }, 2), 0, 1);
  assert.deepEqual(Array.from(oriented), [0, 0, 0, 0, 255, 255, 255, 255]);
  assert.throws(() => core.encodeRaw16([NaN], 0, 1));
  assert.throws(() => core.sampleGrid(() => 0, frame, 1));
});

test('world aspect ratio affects interpolated distances, while constraints stay exact', () => {
  const contour = square('ring', 10, 0.1, 0.9), pins = [{ id: 'peak', x: 0.5, y: 0.5, height: 30 }];
  const normal = core.prepare([contour], pins, 0);
  const wide = core.prepare([contour], pins, 0, { scaleX: 4, scaleY: 1 });
  near(wide.sample(0.1, 0.5), 10);
  near(wide.sample(0.5, 0.5), 30);
  assert.ok(wide.sample(0.3, 0.5) < normal.sample(0.3, 0.5));
});

test('positive smoothness keeps a common tangent at open and closed control nodes', () => {
  const direction = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / Math.hypot(a.x, a.y) / Math.hypot(b.x, b.y))));
  for (const closed of [false, true]) for (const smooth of [0.2, 0.6, 1]) {
    const contour = { ...square('tangent', 10, 0.25, 0.75), closed, smooth };
    const path = core.curvePoints(contour);
    assert.deepEqual(path[0], contour.points[0]);
    if (!closed) assert.deepEqual(path[path.length - 1], contour.points[contour.points.length - 1]);
    for (const p of contour.points.slice(closed ? 0 : 1, closed ? undefined : -1)) {
      const i = path.findIndex(q => q.x === p.x && q.y === p.y);
      assert.ok(i >= 0, 'original control point remains on the curve');
      const before = path[(i + path.length - 1) % path.length], after = path[(i + 1) % path.length];
      assert.ok(angle(direction(before, p), direction(p, after)) < Math.PI / 40, 'display chords share the node tangent within 4.5 degrees');
    }
  }
  const angular = square('angular', 10, 0.25, 0.75, 0);
  assert.deepEqual(core.curvePoints(angular), angular.points);
});

test('adaptive curve stays within 1e-4 UV of the exact cubic without excessive samples', () => {
  const contour = { id: 'adaptive', height: 5, closed: false, smooth: 0.65, points: [{ x: 0.1, y: 0.3 }, { x: 0.4, y: 0.7 }, { x: 0.6, y: 0.2 }, { x: 0.9, y: 0.6 }] };
  const path = core.curvePoints(contour), points = contour.points;
  let maxError = 0;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const a = points[Math.max(0, segment - 1)], b = points[segment], c = points[segment + 1], d = points[Math.min(points.length - 1, segment + 2)];
    for (let step = 0; step <= 100; step++) {
      const t = step / 100, t2 = t * t, t3 = t2 * t, p = {};
      for (const axis of ['x', 'y']) {
        const tangentB = contour.smooth * (c[axis] - a[axis]) / 2, tangentC = contour.smooth * (d[axis] - b[axis]) / 2;
        p[axis] = (2 * t3 - 3 * t2 + 1) * b[axis] + (t3 - 2 * t2 + t) * tangentB + (-2 * t3 + 3 * t2) * c[axis] + (t3 - t2) * tangentC;
      }
      let distance = Infinity;
      for (let i = 0; i < path.length - 1; i++) distance = Math.min(distance, core.closestPoint(p, path[i], path[i + 1]).distance);
      maxError = Math.max(maxError, distance);
    }
  }
  assert.ok(maxError <= 1e-4, `${maxError} UV error`);
  assert.ok(path.length < 512);
  const many = { ...contour, points: Array.from({ length: 96 }, (_, i) => ({ x: 0.05 + 0.9 * i / 95, y: i % 2 ? 0.7 : 0.3 })) };
  assert.ok(core.curvePoints(many).length < 12000);
  const straight = { ...contour, points: Array.from({ length: 96 }, (_, i) => ({ x: 0.05 + 0.9 * i / 95, y: 0.5 })) };
  assert.equal(core.curvePoints(straight).length, 96);
});

test('joining chooses all four endpoint orientations and preserves a direction and metadata', () => {
  const baseA = { id: 'a', name: 'first', height: 10, smooth: 0.6, closed: false, points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }] };
  const baseB = { id: 'b', height: 10, smooth: 0.1, closed: false, points: [{ x: 0.31, y: 0.5 }, { x: 0.6, y: 0.5 }] };
  for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
    const a = { ...baseA, points: reverseA ? baseA.points.slice().reverse() : baseA.points.slice() };
    const b = { ...baseB, points: reverseB ? baseB.points.slice().reverse() : baseB.points.slice() };
    const snapshot = JSON.stringify([a, b]), result = core.joinOpenContours(a, b);
    assert.deepEqual(result.ends, { a: reverseA ? 'start' : 'end', b: reverseB ? 'end' : 'start' });
    near(result.gap, 0.01);
    assert.equal(result.contour.id, a.id); assert.equal(result.contour.name, a.name); assert.equal(result.contour.smooth, a.smooth);
    assert.equal(result.contour.points.length, 3);
    const expected = [{ x: 0.1, y: 0.5 }, { x: 0.305, y: 0.5 }, { x: 0.6, y: 0.5 }];
    if (reverseA) expected.reverse();
    result.contour.points.forEach((p, i) => { near(p.x, expected[i].x); near(p.y, expected[i].y); });
    assert.equal(JSON.stringify([a, b]), snapshot, 'inputs are not mutated');
  }
});

test('shared endpoints collapse and a valid joined curve stays smooth at the joint', () => {
  const a = { id: 'a', height: 10, closed: false, smooth: 0.7, points: [{ x: 0.1, y: 0.3 }, { x: 0.4, y: 0.5 }] };
  const b = { id: 'b', height: 10, closed: false, smooth: 0.7, points: [{ x: 0.4, y: 0.5 }, { x: 0.7, y: 0.2 }] };
  const result = core.joinOpenContours(a, b, { maxGap: 0 });
  assert.equal(result.gap, 0); assert.equal(result.contour.points.length, 3);
  assert.deepEqual(core.validate([result.contour], []), []);
  const path = core.curvePoints(result.contour), joint = path.findIndex(p => p.x === 0.4 && p.y === 0.5);
  const left = { x: path[joint].x - path[joint - 1].x, y: path[joint].y - path[joint - 1].y };
  const right = { x: path[joint + 1].x - path[joint].x, y: path[joint + 1].y - path[joint].y };
  assert.ok((left.x * right.x + left.y * right.y) / Math.hypot(left.x, left.y) / Math.hypot(right.x, right.y) > 0.997);
});

test('joining rejects height mismatch, excessive gap/point count, invalid sources and self crossing', () => {
  const a = { id: 'a', height: 10, closed: false, smooth: 0, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.9 }] };
  const b = { id: 'b', height: 10, closed: false, smooth: 0, points: [{ x: 0.11, y: 0.9 }, { x: 0.8, y: 0.1 }] };
  assert.throws(() => core.joinOpenContours(a, b), /自分自身/);
  assert.throws(() => core.joinOpenContours(a, { ...b, height: 20 }), /同じ標高/);
  assert.throws(() => core.joinOpenContours(a, b, { maxGap: 0.001 }), /離れすぎ/);
  assert.throws(() => core.joinOpenContours({ ...a, closed: true }, b), /開いた/);
  assert.throws(() => core.joinOpenContours(a, a), /異なる/);
  assert.throws(() => core.joinOpenContours(a, { ...b, height: NaN }), /同じ標高/);
  const longA = { ...a, points: Array.from({ length: 50 }, (_, i) => ({ x: 0.1 + 0.4 * i / 49, y: 0.3 })) };
  const longB = { ...b, points: Array.from({ length: 48 }, (_, i) => ({ x: 0.5 + 0.4 * i / 47, y: 0.3 })) };
  assert.throws(() => core.joinOpenContours(longA, longB), /96点/);
});
