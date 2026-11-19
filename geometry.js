/* Shared display, validation, and approximate height interpolation geometry. No dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ContourCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EPS = 1e-8;
  const MAX_CONTOURS = 256, MAX_POINTS = 4096, MAX_TOTAL_POINTS = 24000, MAX_PINS = 4096;
  const finite = Number.isFinite;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sq = x => x * x;
  const same = (a, b) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;

  function cleanPoints(points, closed) {
    const result = [];
    for (const p of points || []) {
      if (!result.length || !same(p, result[result.length - 1])) result.push({ x: p.x, y: p.y });
    }
    if (closed && result.length > 1 && same(result[0], result[result.length - 1])) result.pop();
    return result;
  }

  // Shared cardinal tangents make every positive smoothness C1 at the control points.
  // Adaptive Bezier flattening targets 1e-4 UV error and a 2 degree tangent error.
  // The returned closed path has no repeated last point; original vertices stay exact.
  function curvePoints(contour) {
    const p = cleanPoints(contour.points, contour.closed), n = p.length;
    const smooth = clamp(Number(contour.smooth) || 0, 0, 1);
    if (!smooth || n < 3) return p;
    const result = [{ ...p[0] }], count = contour.closed ? n : n - 1;
    const at = i => p[contour.closed ? (i + n) % n : clamp(i, 0, n - 1)];
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const maxAngle = Math.tan(Math.PI / 90), tolerance2 = 1e-8;
    const aligned = (dx, dy, tx, ty) => {
      if (tx * tx + ty * ty < 1e-24) return true;
      const dot = dx * tx + dy * ty;
      return dot > 0 && Math.abs(dx * ty - dy * tx) <= dot * maxAngle;
    };
    function flatten(a, b, c, d, depth) {
      const dx = d.x - a.x, dy = d.y - a.y;
      const flat = Math.max(distance2(b, a, d), distance2(c, a, d)) <= tolerance2;
      if (depth === 12 || (flat && aligned(dx, dy, b.x - a.x, b.y - a.y) && aligned(dx, dy, d.x - c.x, d.y - c.y))) {
        result.push({ ...d }); return;
      }
      const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
      const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd);
      flatten(a, ab, abc, center, depth + 1);
      flatten(center, bcd, cd, d, depth + 1);
    }
    for (let i = 0; i < count; i++) {
      const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
      const first = { x: b.x + smooth * (c.x - a.x) / 6, y: b.y + smooth * (c.y - a.y) / 6 };
      const second = { x: c.x - smooth * (d.x - b.x) / 6, y: c.y - smooth * (d.y - b.y) / 6 };
      flatten(b, first, second, c, 0);
    }
    if (contour.closed) result.pop();
    return result;
  }

  function closestPoint(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1) : 0;
    const x = a.x + t * dx, y = a.y + t * dy;
    return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
  }

  function distance2(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    const t = length2 ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1) : 0;
    return sq(point.x - a.x - t * dx) + sq(point.y - a.y - t * dy);
  }

  // Iterative Ramer-Douglas-Peucker; accepts open strokes and a repeated closing endpoint.
  function simplify(points, tolerance) {
    if (!Array.isArray(points) || points.length < 3 || !(tolerance > 0)) return (points || []).map(p => ({ ...p }));
    const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]], tol2 = tolerance * tolerance;
    keep[0] = keep[points.length - 1] = 1;
    while (stack.length) {
      const [start, end] = stack.pop();
      let best = tol2, index = -1;
      for (let i = start + 1; i < end; i++) {
        const d = distance2(points[i], points[start], points[end]);
        if (d > best) { best = d; index = i; }
      }
      if (index !== -1) { keep[index] = 1; stack.push([start, index], [index, end]); }
    }
    return points.filter((_, i) => keep[i]).map(p => ({ ...p }));
  }

  function pathDistance(point, points, closed) {
    let best = Infinity;
    for (let i = 0, n = closed ? points.length : points.length - 1; i < n; i++) {
      best = Math.min(best, distance2(point, points[i], points[(i + 1) % points.length]));
    }
    return Math.sqrt(best);
  }

  function pointInPolygon(point, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      if (distance2(point, a, b) <= EPS * EPS) return true;
      if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function area(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a / 2);
  }

  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  function segmentMeeting(a, b, c, d) {
    if (Math.max(a.x, b.x) + EPS < Math.min(c.x, d.x) || Math.max(c.x, d.x) + EPS < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) + EPS < Math.min(c.y, d.y) || Math.max(c.y, d.y) + EPS < Math.min(a.y, b.y)) return null;
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    const epsAB = EPS * Math.hypot(b.x - a.x, b.y - a.y), epsCD = EPS * Math.hypot(d.x - c.x, d.y - c.y);
    if (Math.abs(abC) <= epsAB && Math.abs(abD) <= epsAB && Math.abs(cdA) <= epsCD && Math.abs(cdB) <= epsCD) {
      const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y';
      const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
        Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
      return overlap >= -EPS ? { overlap: overlap > EPS } : null;
    }
    if (((abC > epsAB && abD > epsAB) || (abC < -epsAB && abD < -epsAB)) ||
      ((cdA > epsCD && cdB > epsCD) || (cdA < -epsCD && cdB < -epsCD))) return null;
    return { overlap: false };
  }

  function validate(contours = [], pins = []) {
    const issues = [], paths = [], edges = [], seenIssues = new Set();
    const add = (message, ids, key) => {
      if (!seenIssues.has(key || message + ids.join('|'))) {
        issues.push({ message, ids }); seenIssues.add(key || message + ids.join('|'));
      }
    };
    if (!Array.isArray(contours) || !Array.isArray(pins)) return [{ message: '等高線と標高点のデータ形式が不正です。', ids: [] }];
    if (contours.length > MAX_CONTOURS || pins.length > MAX_PINS) return [{ message: '等高線または標高点の数が上限を超えています。', ids: [] }];
    let total = 0;
    for (let ci = 0; ci < contours.length; ci++) {
      const c = contours[ci], id = c && c.id != null ? c.id : `contour-${ci}`;
      if (!c || !finite(c.height) || !Array.isArray(c.points) || c.points.length > MAX_POINTS ||
        c.points.some(p => !p || !finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) ||
        (c.smooth != null && (!finite(c.smooth) || c.smooth < 0 || c.smooth > 1))) {
        add('等高線の標高・座標・点数・滑らかさを確認してください。', [id]); continue;
      }
      total += c.points.length;
      const points = curvePoints(c), count = c.closed ? points.length : points.length - 1;
      if (points.length < (c.closed ? 3 : 2)) { add('閉じた線は3点、開いた線は2点以上必要です。', [id]); continue; }
      if (points.some(p => p.x < -EPS || p.x > 1 + EPS || p.y < -EPS || p.y > 1 + EPS)) {
        add('滑らかにした等高線が画像の外にはみ出しています。', [id]);
      }
      if (c.closed && area(points) <= EPS * EPS) add('閉じた等高線の面積がありません。', [id]);
      const path = { ...c, id, points, ci, count }; paths.push(path);
      for (let i = 0; i < count; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        edges.push({ a, b, path, i, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
      }
    }
    if (total > MAX_TOTAL_POINTS) return [...issues, { message: '等高線の合計点数が上限を超えています。', ids: [] }];
    // Sweep along x to avoid comparing unrelated segment pairs on typical drawings.
    edges.sort((a, b) => a.minX - b.minX);
    let active = [];
    for (const edge of edges) {
      active = active.filter(other => other.maxX + EPS >= edge.minX);
      for (const other of active) {
        if (other.maxY + EPS < edge.minY || edge.maxY + EPS < other.minY) continue;
        const samePath = edge.path === other.path;
        if (!samePath && Math.abs(edge.path.height - other.path.height) <= EPS) continue;
        const meet = segmentMeeting(edge.a, edge.b, other.a, other.b);
        if (!meet) continue;
        if (samePath) {
          const difference = Math.abs(edge.i - other.i);
          const adjacent = difference === 1 || (edge.path.closed && difference === edge.path.count - 1);
          if (!adjacent || meet.overlap) add('等高線が自分自身と交差・接触しています。', [edge.path.id], `self:${edge.path.ci}`);
        } else {
          const a = Math.min(edge.path.ci, other.path.ci), b = Math.max(edge.path.ci, other.path.ci);
          add('異なる標高の等高線が交差・接触しています。', [edge.path.id, other.path.id], `cross:${a}:${b}`);
        }
      }
      active.push(edge);
    }
    const goodPins = [];
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i], id = p && p.id != null ? p.id : `pin-${i}`;
      if (!p || !finite(p.x) || !finite(p.y) || !finite(p.height) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        add('標高点の標高・座標を確認してください。', [id]); continue;
      }
      for (const q of goodPins) if (same(p, q) && Math.abs(p.height - q.height) > EPS) add('同じ位置の標高点に異なる標高があります。', [id, q.id]);
      for (const path of paths) if (Math.abs(p.height - path.height) > EPS && pathDistance(p, path.points, path.closed) <= EPS) {
        add('等高線上の標高点が、線と異なる標高です。', [id, path.id]);
      }
      goodPins.push({ ...p, id });
    }
    return issues;
  }

  // Retains a's direction/metadata and joins the nearest endpoint pair at its midpoint.
  // The caller should validate this replacement against the rest of the project.
  function joinOpenContours(a, b, options = {}) {
    if (!a || !b || a.closed || b.closed) throw new Error('接続するには開いた等高線を2本選んでください。');
    if (a === b || (a.id != null && b.id != null && a.id === b.id)) throw new Error('異なる等高線を2本選んでください。');
    if (!finite(a.height) || !finite(b.height) || Math.abs(a.height - b.height) > EPS) throw new Error('同じ標高の等高線だけを接続できます。');
    const issues = [...validate([a], []), ...validate([b], [])];
    if (issues.length) { const error = new Error('接続元の等高線を確認してください：' + issues[0].message); error.issues = issues; throw error; }
    const maxGap = options.maxGap == null ? 0.02 : options.maxGap;
    if (!finite(maxGap) || maxGap < 0) throw new Error('接続できる端点間の距離が不正です。');
    const pa = cleanPoints(a.points, false), pb = cleanPoints(b.points, false);
    let best = null;
    for (const [endA, endB] of [['end', 'start'], ['end', 'end'], ['start', 'end'], ['start', 'start']]) {
      const p = pa[endA === 'start' ? 0 : pa.length - 1], q = pb[endB === 'start' ? 0 : pb.length - 1];
      const gap = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || gap < best.gap) best = { gap, ends: { a: endA, b: endB }, p, q };
    }
    if (best.gap > maxGap + EPS) throw new Error('等高線の端点が離れすぎています。端点を近づけてから接続してください。');
    const joint = { x: (best.p.x + best.q.x) / 2, y: (best.p.y + best.q.y) / 2 };
    const other = best.ends.a === best.ends.b ? pb.slice().reverse() : pb;
    let points;
    if (best.ends.a === 'end') points = [...pa.slice(0, -1), joint, ...other.slice(1)];
    else points = [...other.slice(0, -1), joint, ...pa.slice(1)];
    points = cleanPoints(points, false);
    if (points.length > 96) throw new Error('接続後の制御点が96点を超えます。先に点を減らしてください。');
    const contour = { ...a, closed: false, points };
    const joinedIssues = validate([contour], []);
    if (joinedIssues.length) {
      const selfCrossing = joinedIssues.some(issue => issue.message.includes('自分自身'));
      const error = new Error(selfCrossing ? '接続すると等高線が自分自身と交差・接触します。' : '接続できません：' + joinedIssues[0].message);
      error.issues = joinedIssues; throw error;
    }
    return { contour, gap: best.gap, ends: best.ends };
  }

  function prepare(contours = [], pins = [], baseHeight = 0, options = {}) {
    const issues = validate(contours, pins);
    if (!finite(baseHeight)) issues.push({ message: '基準標高が不正です。', ids: [] });
    const scaleX = options.scaleX == null ? 1 : options.scaleX, scaleY = options.scaleY == null ? 1 : options.scaleY;
    if (!(finite(scaleX) && scaleX > 0 && finite(scaleY) && scaleY > 0)) issues.push({ message: '距離の縮尺が不正です。', ids: [] });
    if (issues.length) { const error = new Error(issues[0].message); error.issues = issues; throw error; }
    const metric = p => ({ x: p.x * scaleX, y: p.y * scaleY });
    const paths = contours.map(c => {
      const points = curvePoints(c);
      return { ...c, points, metricPoints: points.map(metric), area: c.closed ? area(points) : 0, children: [], pins: [], opens: [] };
    });
    const rings = paths.filter(c => c.closed).sort((a, b) => a.area - b.area);
    const outside = { height: baseHeight, children: [], pins: [], opens: [] };
    for (const ring of rings) {
      const parent = rings.find(candidate => candidate.area > ring.area + EPS * EPS && ring.points.every(p => pointInPolygon(p, candidate.points))) || outside;
      parent.children.push(ring);
    }
    const ownerAt = p => rings.find(ring => pointInPolygon(p, ring.points)) || outside;
    for (const p of pins) ownerAt(p).pins.push({ ...p, metric: metric(p) });
    const opens = paths.filter(c => !c.closed);
    for (const path of opens) ownerAt(path.points[0]).opens.push(path);
    const exact = EPS * Math.min(scaleX, scaleY);
    function sample(x, y) {
      if (!finite(x) || !finite(y)) throw new Error('標本座標が不正です。');
      if (x < 0 || x > 1 || y < 0 || y > 1) return baseHeight;
      const point = { x, y }, m = metric(point);
      for (const pin of pins) if (same(point, pin)) return pin.height;
      // Open lines are exact constraints even if they traverse multiple same-height regions.
      for (const path of opens) if (pathDistance(m, path.metricPoints, false) <= exact) return path.height;
      const region = ownerAt(point);
      const boundaryDistance = region === outside ? Math.min(x * scaleX, (1 - x) * scaleX, y * scaleY, (1 - y) * scaleY) : pathDistance(m, region.metricPoints, true);
      if (boundaryDistance <= exact) return region.height;
      let sum = region.height / sq(boundaryDistance), weight = 1 / sq(boundaryDistance);
      for (const child of region.children) {
        const d = pathDistance(m, child.metricPoints, true);
        if (d <= exact) return child.height;
        const w = 1 / sq(d); sum += child.height * w; weight += w;
      }
      for (const pin of region.pins) {
        const d = Math.hypot(m.x - pin.metric.x, m.y - pin.metric.y);
        if (d <= exact) return pin.height;
        const w = 1 / sq(d); sum += pin.height * w; weight += w;
      }
      for (const path of region.opens) {
        const d = pathDistance(m, path.metricPoints, false), w = 1 / sq(d);
        sum += path.height * w; weight += w;
      }
      return sum / weight;
    }
    return { sample, baseHeight, scaleX, scaleY };
  }

  function checkFrame(frame) {
    if (!frame || !['u0', 'v0', 'u1', 'v1'].every(k => finite(frame[k])) || frame.u1 <= frame.u0 || frame.v1 <= frame.v0) throw new Error('出力範囲が不正です。');
  }
  function imageToWorld(point, frame, bounds) {
    checkFrame(frame);
    if (!point || !finite(point.x) || !finite(point.y) || !bounds || !['xMin', 'xMax', 'zMin', 'zMax'].every(k => finite(bounds[k])) || bounds.xMax <= bounds.xMin || bounds.zMax <= bounds.zMin) throw new Error('ワールド座標の範囲が不正です。');
    return {
      x: bounds.xMin + (point.x - frame.u0) / (frame.u1 - frame.u0) * (bounds.xMax - bounds.xMin),
      z: bounds.zMax - (point.y - frame.v0) / (frame.v1 - frame.v0) * (bounds.zMax - bounds.zMin)
    };
  }
  function sampleGrid(prepared, frame, size) {
    checkFrame(frame);
    const width = typeof size === 'number' ? size : size && size.width;
    const height = typeof size === 'number' ? size : size && size.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 4097 || height > 4097) throw new Error('解像度は2〜4097の整数にしてください。');
    const sample = typeof prepared === 'function' ? prepared : prepared && prepared.sample;
    if (typeof sample !== 'function') throw new Error('標高サンプラーが不正です。');
    const result = new Float64Array(width * height);
    for (let row = 0; row < height; row++) {
      const y = frame.v0 + (frame.v1 - frame.v0) * row / (height - 1);
      for (let col = 0; col < width; col++) result[row * width + col] = sample(frame.u0 + (frame.u1 - frame.u0) * col / (width - 1), y);
    }
    return result;
  }
  function encodeRaw16(grid, minHeight, maxHeight) {
    if (!grid || !Number.isSafeInteger(grid.length) || !finite(minHeight) || !finite(maxHeight) || maxHeight <= minHeight) throw new Error('RAWの標高範囲が不正です。');
    const bytes = new Uint8Array(grid.length * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < grid.length; i++) {
      if (!finite(grid[i])) throw new Error('RAW出力に不正な標高値があります。');
      const value = Math.round(clamp((grid[i] - minHeight) / (maxHeight - minHeight), 0, 1) * 65535);
      view.setUint16(i * 2, value, true);
    }
    return bytes;
  }
  return { curvePoints, simplify, validate, joinOpenContours, prepare, closestPoint, pointInPolygon, imageToWorld, sampleGrid, encodeRaw16 };
});
