'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('./geometry.js'),samples=require('./samples.js');
test('valley sample preserves a negative bed and deeper low point',()=>{
  const s=samples.make('valley');assert.deepEqual(core.validate(s.contours,s.pins),[]);
  const p=core.prepare(s.contours,s.pins,s.baseHeight);
  assert.equal(p.sample(.4,.6),-5);
  const v=s.contours[2].points[0];assert.equal(p.sample(v.x,v.y),-4);
  assert.equal(p.sample(0,0),0);
});
test('positive elevation can still form a hollow inside a raised rim',()=>{
  const s=samples.make('sunken');assert.deepEqual(core.validate(s.contours,s.pins),[]);
  const p=core.prepare(s.contours,s.pins,s.baseHeight);
  assert.equal(p.sample(.51,.36),2);
  const v=s.contours[0].points[0];assert.equal(p.sample(v.x,v.y),8);
});
