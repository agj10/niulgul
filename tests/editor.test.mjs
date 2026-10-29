import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/editor-geometry.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { initialEdit, dragEdit, imagePoint, rotate, outputSize, editorBounds, renderEdit } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const origin = { x: 0, y: 0 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const nearPoint = (a, b) => { near(a.x, b.x); near(a.y, b.y); };

test('editor retains the uploaded aspect ratio and exact native dimensions at full resolution', () => {
  for (const [w, h] of [[4032,3024],[3024,4032],[128,128],[4000,300],[24,32]]) {
    const edit = initialEdit(w, h);
    near(edit.image.width / edit.image.height, w / h);
    assert.deepEqual(outputSize(edit.frame, Math.max(w,h)), {width:w,height:h});
  }
});
test('corners resize width and height independently by default, like Figma', () => {
  const edit = initialEdit(400,200), before = structuredClone(edit);
  const resized = dragEdit(edit,'resize-se',origin,{x:100,y:0});
  near(resized.image.width, edit.image.width + 100);
  near(resized.image.height, edit.image.height);
  assert.notEqual(resized.image.width/resized.image.height, 2);
  assert.deepEqual(edit,before);
});
test('Shift constrains a corner to the original bitmap ratio, even after stretching', () => {
  const edit = initialEdit(400,200);
  edit.image.width *= 1.4;
  const changed = dragEdit(edit,'resize-se',origin,{x:40,y:50},2);
  near(changed.image.width/changed.image.height,2);
  nearPoint(imagePoint(edit.image,-edit.image.width/2,-edit.image.height/2), imagePoint(changed.image,-changed.image.width/2,-changed.image.height/2));
});
test('all rotated resize corners preserve the opposite corner, with and without Shift', () => {
  for (const angle of [-145,-90,-20,0,45,90,170]) for (const corner of ['nw','ne','se','sw']) for (const aspect of [undefined,2]) {
    const edit=initialEdit(400,200); edit.image.angle=angle;
    const x=corner.includes('e')?1:-1, y=corner.includes('s')?1:-1;
    const changed=dragEdit(edit,'resize-'+corner,origin,rotate({x:35*x,y:22*y},angle),aspect);
    nearPoint(imagePoint(edit.image,-x*edit.image.width/2,-y*edit.image.height/2), imagePoint(changed.image,-x*changed.image.width/2,-y*changed.image.height/2));
    if(aspect)near(changed.image.width/changed.image.height,aspect);
  }
});
test('edge resizing changes only the selected axis, including rotated objects', () => {
  for(const angle of [0,45,90])for(const edge of ['n','e','s','w']) {
    const edit=initialEdit(400,200);edit.image.angle=angle;
    const dx=edge==='e'?30:edge==='w'?-30:0,dy=edge==='s'?30:edge==='n'?-30:0;
    const changed=dragEdit(edit,'resize-'+edge,origin,rotate({x:dx,y:dy},angle));
    near(changed.image.width,edit.image.width+Math.abs(dx));near(changed.image.height,edit.image.height+Math.abs(dy));
  }
});
test('moving or rotating a photo keeps the output frame fixed', () => {
  const edit=initialEdit(400,200);
  const moved=dragEdit(edit,'move',origin,{x:42,y:-18});
  near(moved.image.x,edit.image.x+42);near(moved.image.y,edit.image.y-18);
  assert.deepEqual(moved.frame,edit.frame);
  const rotated=dragEdit(edit,'rotate',{x:edit.image.x,y:edit.image.y-100},{x:edit.image.x+100,y:edit.image.y});
  near(rotated.image.angle,90);near(rotated.image.x,edit.image.x);near(rotated.image.y,edit.image.y);assert.deepEqual(rotated.frame,edit.frame);
});
test('all four crop bars adjust the exported region without altering the image', () => {
  for(const edge of ['n','e','s','w']) {
    const edit=initialEdit(400,200), delta={x:edge==='w'?30:edge==='e'?-30:0,y:edge==='n'?30:edge==='s'?-30:0};
    const cropped=dragEdit(edit,'crop-'+edge,origin,delta);
    assert.deepEqual(cropped.image,edit.image);
    near(cropped.frame.width,edit.frame.width-Math.abs(delta.x));near(cropped.frame.height,edit.frame.height-Math.abs(delta.y));
    assert.notDeepEqual(outputSize(cropped.frame,400),outputSize(edit.frame,400));
  }
});
test('dragging across opposite edges cannot create zero, negative or non-finite sizes', () => {
  for(const gesture of ['crop-w','crop-n','crop-e','crop-s','resize-nw','resize-se','resize-w','resize-s']) {
    for(const amount of [-1e5,1e5]) {
      const changed=dragEdit(initialEdit(400,200),gesture,origin,{x:amount,y:amount},2);
      for(const key of ['frame','image']){assert.ok(changed[key].width>0&&changed[key].height>0);assert.ok(Object.values(changed[key]).every(v=>typeof v!=='number'||Number.isFinite(v)));}
      const size=outputSize(changed.frame,32);assert.ok(size.width>=1&&size.height>=1);
    }
  }
});
test('editor viewport includes photo corners and output frame after rotation and movement', () => {
  for(const [w,h] of [[4000,100],[100,4000],[128,128]])for(const angle of [0,35,90,170]) {
    const edit=initialEdit(w,h);edit.image.angle=angle;edit.image.x+=700;
    const bounds=editorBounds(edit);
    const points=[imagePoint(edit.image,-edit.image.width/2,-edit.image.height/2),imagePoint(edit.image,edit.image.width/2,edit.image.height/2),edit.frame,{x:edit.frame.x+edit.frame.width,y:edit.frame.y+edit.frame.height}];
    for(const point of points){assert.ok(point.x>=bounds.x&&point.x<=bounds.x+bounds.width);assert.ok(point.y>=bounds.y&&point.y<=bounds.y+bounds.height);}
  }
});
test('applied pixels use the same crop, rotation, movement and flips as the preview', () => {
  const calls=[], ctx=Object.fromEntries(['fillRect','scale','translate','rotate','drawImage'].map(name=>[name,(...args)=>calls.push([name,...args])]));
  const output={getContext:()=>ctx};
  const previous=globalThis.document;globalThis.document={createElement:()=>output};
  try {
    const edit=initialEdit(400,200);edit.image.angle=90;edit.image.flipX=true;edit.image.flipY=true;edit.image.x+=15;
    const bitmap={bitmap:true};assert.equal(renderEdit(bitmap,edit,200),output);
    assert.equal(output.width,200);assert.equal(output.height,100);
    assert.deepEqual(calls,[['fillRect',0,0,200,100],['scale',200/edit.frame.width,100/edit.frame.height],['translate',-edit.frame.x,-edit.frame.y],['translate',edit.image.x,edit.image.y],['rotate',Math.PI/2],['scale',-1,-1],['drawImage',bitmap,-edit.image.width/2,-edit.image.height/2,edit.image.width,edit.image.height]]);
    assert.equal(ctx.fillStyle,'#fff');
  } finally {globalThis.document=previous;}
});
test('viewport math keeps 44px touch handles reachable at phone, landscape and desktop dimensions', () => {
  for(const [width,height] of [[280,220],[328,330],[362,355],[600,220],[814,376]])for(const angle of [0,45,90,160]) {
    const edit=initialEdit(4032,3024);edit.image.angle=angle;
    const bounds=editorBounds(edit,width,width/height),unit=bounds.width/width;
    const handles=[imagePoint(edit.image,0,-edit.image.height/2-34*unit),...[-1,1].flatMap(x=>[-1,1].map(y=>imagePoint(edit.image,x*edit.image.width/2,y*edit.image.height/2)))];
    for(const point of handles) {
      assert.ok(point.x-22*unit>=bounds.x&&point.x+22*unit<=bounds.x+bounds.width);
      assert.ok(point.y-22*unit>=bounds.y&&point.y+22*unit<=bounds.y+bounds.height);
    }
  }
});
