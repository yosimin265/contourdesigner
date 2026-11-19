const assert = require('node:assert/strict');
const test = require('node:test');
const { read } = require('./ai-plan.js');

const dimensions = { width: 960, height: 600 };
const plan = overrides => ({
  schema: 'contourdesigner.ai-plan', version: 1, imageSize: dimensions,
  contours: [{ height: 4, points: [[0.2, 0.2], [0.7, 0.3], [0.5, 0.7]] }],
  ...overrides
});

test('normalizes a minimal plan with fresh, unique IDs and editable points', () => {
  const input = plan({pins: [{name:'山頂', height:7, x:0.5, y:0.4}]});
  const parsed = read(input, dimensions);
  assert.equal(parsed.name, '');
  assert.equal(parsed.baseHeight, 0);
  assert.equal(parsed.contours[0].closed, true);
  assert.equal(parsed.contours[0].smooth, 0.4);
  assert.deepEqual(parsed.contours[0].points[0], {x:0.2, y:0.2});
  assert.notEqual(parsed.contours[0].id, parsed.pins[0].id);
  assert.deepEqual(input.contours[0].points[0], [0.2,0.2]);
});

test('preserves source orientation and rejects a different size even when the aspect ratio matches', () => {
  assert.throws(() => read(plan({imageSize:{width:480,height:300}}), dimensions), /画像サイズ/);
  assert.throws(() => read(plan({imageSize:{width:600,height:960}}), dimensions), /画像サイズ/);
  assert.throws(() => read(plan({imageSize:{width:0,height:600}}), dimensions), /imageSize/);
  for (const data of [null, {}, plan({version:2}), plan({schema:'unexpected'})]) {
    assert.throws(() => read(data, dimensions), /AI等高線用/);
  }
});

test('supports open lines, zero smoothing and pins-only plans with negative heights', () => {
  const open = read(plan({contours:[{height:0,closed:false,smooth:0,points:[[0,0],[1,1]]}]}), dimensions);
  assert.equal(open.contours[0].closed,false);
  assert.equal(open.contours[0].smooth,0);
  const pins = read(plan({name:'池',baseHeight:-1,contours:undefined,pins:[{x:0,y:1,height:-3}]}), dimensions);
  assert.equal(pins.baseHeight,-1);
  assert.equal(pins.name,'池');
});

test('rejects invalid coordinates, counts, heights and contradictory geometry before import', () => {
  assert.throws(() => read(plan({contours:[]}), dimensions), /1件以上/);
  assert.throws(() => read(plan({contours:Array(33).fill({})}), dimensions), /32本/);
  assert.throws(() => read(plan({baseHeight:201}), dimensions), /基準高/);
  assert.throws(() => read(plan({pins:[{x:1.2,y:0,height:0}]}), dimensions), /0〜1/);
  assert.throws(() => read(plan({contours:[{closed:'yes',height:1,points:[]}]}), dimensions), /closed/);
  assert.throws(() => read(plan({contours:[{height:1,points:[[0,0],[0,'0.2'],[1,1]]}]}), dimensions), /点目/);
  assert.throws(() => read(plan({name:{}}), dimensions), /名前/);
  assert.throws(() => read(plan({contours:[
    {height:1,closed:false,points:[[0,0],[1,1]]},
    {height:2,closed:false,points:[[0,1],[1,0]]}
  ]}), dimensions), /交差|接触/);
});
