#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { read: readPlan } = require('./ai-plan.js');
const { curvePoints } = require('./geometry.js');

const usage = 'node render-contours.cjs landscape.jpg example.ai-plan.json landscape-contours.svg';
const invalid = () => { throw new Error('画像形式または画像ヘッダーが不正です。PNG・JPEG・WebPを使用してください。'); };

// EXIF orientations 5–8 swap the dimensions reported by browsers for portrait photos.
function exifOrientation(data) {
  if (data.subarray(0, 6).toString('latin1') === 'Exif\0\0') data = data.subarray(6);
  if (data.length < 8) return 1;
  const byteOrder = data.toString('latin1', 0, 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return 1;
  const u16 = offset => byteOrder === 'II' ? data.readUInt16LE(offset) : data.readUInt16BE(offset);
  const u32 = offset => byteOrder === 'II' ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
  if (u16(2) !== 42) return 1;
  const start = u32(4);
  if (start + 2 > data.length) return 1;
  const end = Math.min(data.length, start + 2 + u16(start) * 12);
  for (let i = start + 2; i + 12 <= end; i += 12) {
    if (u16(i) === 0x112 && u16(i + 2) === 3 && u32(i + 4) === 1) return u16(i + 8);
  }
  return 1;
}

function rasterSize(data, mime) {
  let width = 0, height = 0, orientation = 1;
  if (mime === 'image/png') {
    if (data.length < 33 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
        data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') invalid();
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
    let hasPixels = false, hasEnd = false;
    for (let i = 8; i + 12 <= data.length;) {
      const size = data.readUInt32BE(i), tag = data.toString('latin1', i + 4, i + 8);
      if (i + 12 + size > data.length) invalid();
      if (tag === 'eXIf') orientation = exifOrientation(data.subarray(i + 8, i + 8 + size));
      if (tag === 'IDAT' && size) hasPixels = true;
      if (tag === 'IEND' && !size) { hasEnd = true; break; }
      i += 12 + size;
    }
    if (!hasPixels || !hasEnd) invalid();
  } else if (mime === 'image/jpeg') {
    if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) invalid();
    let hasScan = false;
    for (let i = 2; i + 3 < data.length;) {
      if (data[i++] !== 0xff) invalid();
      while (i < data.length && data[i] === 0xff) i++;
      const tag = data[i++];
      if (i + 2 > data.length) invalid();
      const size = data.readUInt16BE(i);
      if (size < 2 || i + size > data.length) invalid();
      if (tag === 0xda) { hasScan = true; break; }
      if (tag === 0xe1 && data.toString('latin1', i + 2, i + 8) === 'Exif\0\0') {
        orientation = exifOrientation(data.subarray(i + 2, i + size));
      }
      if (tag >= 0xc0 && tag <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(tag)) {
        if (size < 8) invalid();
        height = data.readUInt16BE(i + 3); width = data.readUInt16BE(i + 5);
      }
      i += size;
    }
    if (!hasScan) invalid();
  } else {
    if (data.length < 20 || data.toString('latin1', 0, 4) !== 'RIFF' ||
        data.toString('latin1', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) invalid();
    let hasPixels = false;
    for (let i = 12; i + 8 <= data.length;) {
      const tag = data.toString('latin1', i, i + 4), length = data.readUInt32LE(i + 4), start = i + 8;
      if (start + length > data.length) invalid();
      if (tag === 'VP8X' && length >= 10) {
        width = 1 + data.readUIntLE(start + 4, 3); height = 1 + data.readUIntLE(start + 7, 3);
      } else if (tag === 'VP8 ' && length >= 10 && data.toString('hex', start + 3, start + 6) === '9d012a') {
        hasPixels = true;
        if (!width) { width = data.readUInt16LE(start + 6) & 0x3fff; height = data.readUInt16LE(start + 8) & 0x3fff; }
      } else if (tag === 'VP8L' && length >= 5 && data[start] === 0x2f) {
        hasPixels = true;
        const bits = data.readUInt32LE(start + 1);
        if (!width) { width = 1 + (bits & 0x3fff); height = 1 + ((bits >>> 14) & 0x3fff); }
      } else if (tag === 'ANMF' && length >= 24) hasPixels = true;
      else if (tag === 'EXIF') orientation = exifOrientation(data.subarray(start, start + length));
      i = start + length + (length & 1);
    }
    if (!hasPixels) invalid();
  }
  if (!width || !height) invalid();
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

function readFile(name, maxBytes) {
  const stat = fs.statSync(name);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`${name} は ${maxBytes / 1024} KB 以内の通常のファイルを指定してください。`);
  return fs.readFileSync(name);
}

function escapeText(text) {
  return text.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '\ufffd')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeSvg(plan, size, mime, data) {
  const { width, height } = size;
  const scale = Math.max(0.8, Math.min(width, height * 1.5) / 1000);
  const heights = [plan.baseHeight, ...plan.contours.map(l => l.height), ...plan.pins.map(p => p.height)];
  const min = Math.min(...heights), max = Math.max(...heights);
  const palette = [[80,117,182], [96,177,177], [171,195,107], [226,151,76]];
  function color(h) {
    const t = min === max ? 1.5 : 3 * (h - min) / (max - min), i = Math.min(2, Math.floor(t));
    const rgb = palette[i].map((v, k) => Math.round(v + (t - i) * (palette[i + 1][k] - v)));
    return `rgb(${rgb.join(',')})`;
  }
  const n = x => Number(x.toFixed(3));
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeText(plan.name || '等高線図')}</title>`,
    `<image width="${width}" height="${height}" preserveAspectRatio="none" href="data:${mime};base64,${data.toString('base64')}"/>`,
    '<g fill="none" stroke-linejoin="round" stroke-linecap="round">'
  ];
  const labels = [];
  function label(point, h) {
    const right = point.x > 0.9, anchor = right ? 'end' : 'start';
    const x = point.x * width + (right ? -9 : 9) * scale;
    const y = point.y * height + (point.y * height < 19 * scale ? 16 : -6) * scale;
    labels.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}">${h} m</text>`);
  }
  for (const line of plan.contours) {
    const points = curvePoints(line);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x * width)} ${n(p.y * height)}`).join(' ') + (line.closed ? ' Z' : '');
    svg.push(`<g><title>${escapeText(line.name)}</title>`, `<path d="${d}" stroke="#0c1424" stroke-opacity=".75" stroke-width="${n(4 * scale)}"/>`,
      `<path d="${d}" stroke="${color(line.height)}" stroke-width="${n(1.9 * scale)}"/></g>`);
    label(points[0], line.height);
  }
  for (const pin of plan.pins) {
    svg.push(`<circle cx="${n(pin.x * width)}" cy="${n(pin.y * height)}" r="${n(4.5 * scale)}" fill="${color(pin.height)}" stroke="white" stroke-width="${n(2 * scale)}"><title>${escapeText(pin.name)}</title></circle>`);
    label(pin, pin.height);
  }
  svg.push('</g>', `<g font-family="sans-serif" font-size="${n(12 * scale)}" font-weight="600" fill="white" stroke="#16212d" stroke-width="${n(4 * scale)}" stroke-linejoin="round" paint-order="stroke fill">`, ...labels, '</g></svg>');
  return svg.join('\n') + '\n';
}

function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage); return; }
  if (args.length !== 3) throw new Error(usage);
  const [imageFile, planFile, outputFile] = args;
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(imageFile).toLowerCase()];
  if (!mime || path.extname(planFile).toLowerCase() !== '.json' || path.extname(outputFile).toLowerCase() !== '.svg') throw new Error(usage);
  const data = readFile(imageFile, 8 * 1024 * 1024);
  const size = rasterSize(data, mime);
  const plan = readPlan(JSON.parse(readFile(planFile, 512 * 1024).toString('utf8')), size);
  const svg = makeSvg(plan, size, mime, data);
  fs.writeFileSync(outputFile, svg, { flag: 'wx' });
  console.log(`${outputFile} (${size.width} × ${size.height} px)`);
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
