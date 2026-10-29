import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleFromTS(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  for (const [from, to] of Object.entries(imports)) outputText = outputText.replaceAll(from, to);
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const runtimeText = ts.transpileModule(await readFile(new URL('../src/original-core.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const runtimeURL = 'data:text/javascript;base64,' + Buffer.from(runtimeText).toString('base64');
const runtime = await import(runtimeURL);
runtime.configureOriginalCore(await readFile(new URL('../public/engine/original.wasm', import.meta.url)));
const { Simulation } = await moduleFromTS('../src/simulation.ts', { './original-core': runtimeURL });
const { LatestJobs } = await moduleFromTS('../src/jobs.ts');

function solve(w = 16, h = 16, side = 16, tone = 100, identity = false) {
  const e = runtime.instantiateOriginalCore(); e.prepare(w, h, w, h);
  const source = new Uint8Array(e.memory.buffer, e.input_source_pointer(), w * h * 4);
  const target = new Uint8Array(e.memory.buffer, e.input_target_pointer(), w * h * 4);
  for (let i = 0; i < w * h; i++) {
    source.set([i * 73 % 256, i * 23 % 256, i * 47 % 256, 255], i * 4);
    target.set([255 - i % 256, i * 31 % 256, i * 17 % 256, 255], i * 4);
  }
  e.solve(side, 13, tone, 0, identity ? 1 : 0);
  return {
    assignment: new Uint32Array(e.memory.buffer, e.assignment_pointer(), side * side).slice(),
    source: new Uint8Array(e.memory.buffer, e.source_pointer(), side * side * 4).slice(),
  };
}
test('default settings select native material detail, RGB and original proximity 13', () => {
  assert.deepEqual(runtime.ORIGINAL_SETTINGS, { strength: 50, tone: 100, cellSize: 1 });
  assert.equal(runtime.proximityForStrength(50), 13);
});
test('upstream Rust optimizer uses each prepared pixel once', () => {
  for (const [w,h] of [[16,16],[24,12],[12,24]]) {
    const { assignment } = solve(w,h);
    assert.deepEqual([...assignment].sort((a,b)=>a-b), Array.from({length:256},(_,i)=>i));
  }
});
test('source colors are preserved; optional tone preparation only changes matching', () => {
  const color=solve(), luma=solve(16,16,16,0);
  assert.deepEqual(color.source,luma.source);
  assert.notDeepEqual(color.assignment,luma.assignment);
  for(let i=0;i<256;i++)assert.deepEqual([...color.source.slice(i*4,i*4+4)],[i*73%256,i*23%256,i*47%256,255]);
});
test('upstream FRand seeded solve is repeatable', () => assert.deepEqual(solve().assignment,solve().assignment));
test('zero strength bypass retains the source arrangement', () => assert.deepEqual([...solve(16,16,16,100,true).assignment],Array.from({length:256},(_,i)=>i)));
test('upstream Rust fluid simulation runs real frames without a forced snap at 216', () => {
  const sim=new Simulation({width:16,height:16,assignment:Uint32Array.from({length:256},(_,i)=>255-i)});
  const initial=sim.error;
  for(const frame of [0,1,60,180,216])assert.ok([...sim.advance(frame)].every(Number.isFinite));
  assert.notDeepEqual(sim.positions,sim.destinations);
  assert.ok([...sim.advance(600)].every(Number.isFinite));
  assert.ok(sim.error<initial);
});
test('rapid settings finish the running solve, then publish only the newest request', async () => {
  const ran=[],published=[],deferred=[];let idle;
  const done=new Promise(resolve=>{idle=resolve;});
  const q=new LatestJobs({run(value){ran.push(value);return new Promise(resolve=>deferred.push(()=>resolve(value)));},publish(value){published.push(value);},error:assert.fail,busy(){},idle});
  q.request(1);q.request(2);q.request(3);assert.deepEqual(ran,[1]);
  deferred.shift()();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(ran,[1,3]);
  deferred.shift()();await done;assert.deepEqual(published,[3]);
});
test('mode changes invalidate an old result without interrupting Rust', async () => {
  let finish,idle,published=false;const done=new Promise(resolve=>{idle=resolve;});
  const q=new LatestJobs({run(){return new Promise(resolve=>{finish=resolve;});},publish(){published=true;},error:assert.fail,busy(){},idle});
  q.request('camera');q.invalidate();finish('old frame');await done;assert.equal(published,false);
});
