import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/history.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const moduleUrl='data:text/javascript;base64,'+Buffer.from(outputText).toString('base64');
const {retainedImages,readHistory,saveImage,removeImage,HISTORY_LIMIT,HISTORY_BYTES}=await import(moduleUrl);
const image=(id,kind,createdAt,bytes=100)=>({id,kind,createdAt,blob:{size:bytes}});
test('source and face history retain twelve recent images independently',()=>{
  const images=Array.from({length:40},(_,i)=>image(String(i),i%2?'source':'target',i));
  const retained=retainedImages(images);
  assert.equal(retained.length,HISTORY_LIMIT*2);
  assert.deepEqual(retained.map(i=>i.createdAt),Array.from({length:24},(_,i)=>39-i));
  assert.equal(retained.filter(i=>i.kind==='source').length,HISTORY_LIMIT);
});
test('local history stays under its byte budget and prioritizes recent photos',()=>{
  const retained=retainedImages([image('old','target',1,HISTORY_BYTES/2),image('latest','source',3,HISTORY_BYTES/2),image('middle','target',2,HISTORY_BYTES/2)]);
  assert.deepEqual(retained.map(i=>i.id),['latest','middle']);
  assert.ok(retained.reduce((sum,i)=>sum+i.blob.size,0)<=HISTORY_BYTES);
});
test('history ordering does not mutate the caller data and tolerates an oversized record',()=>{
  const images=[image('old','source',1),image('huge','target',3,HISTORY_BYTES+1),image('recent','target',2)];
  assert.deepEqual(retainedImages(images).map(i=>i.id),['recent','old']);
  assert.deepEqual(images.map(i=>i.id),['old','huge','recent']);
});
test('disabled browser storage reports failure without blocking image processing',async()=>{
  await assert.rejects(readHistory(),/사진 기록/);
});
// Request/transaction adapter for unit testing our storage API; real IndexedDB still needs browser QA.
function storageAdapter() {
  const values=new Map();
  const db={transaction(){
    let pending=0,complete=false;
    const tx={objectStore:()=>store};
    const schedule=(fn)=>{
      pending++;queueMicrotask(()=>{fn();pending--;queueMicrotask(()=>{if(!pending&&!complete){complete=true;tx.oncomplete?.();}});});
    };
    const store={
      getAll(){const listeners=[],request={addEventListener:(_event,fn)=>listeners.push(fn)};schedule(()=>{request.result=[...values.values()];request.onsuccess?.();for(const listener of listeners)listener();});return request;},
      put(value){schedule(()=>values.set(value.id,structuredClone(value)));},
      delete(id){schedule(()=>values.delete(id));},
    };
    return tx;
  }};
  return {open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
}
test('history API saves full pixels, deduplicates, restores a new connection and deletes records',async()=>{
  const previousDocument=globalThis.document,previousDB=globalThis.indexedDB;
  globalThis.indexedDB=storageAdapter();
  globalThis.document={createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,thumbnail'})};
  const canvas=value=>({width:128,height:96,toBlob(callback){callback(new Blob([value],{type:'image/png'}));}});
  try {
    const first=await saveImage(canvas('same pixels'),'target','first.png',true);
    const repeated=await saveImage(canvas('same pixels'),'target','renamed.png',true);
    assert.equal(first.saved.id,repeated.saved.id);assert.equal(repeated.images.length,1);
    assert.equal(repeated.saved.framed,true);assert.equal(await repeated.saved.blob.text(),'same pixels');
    const other=await saveImage(canvas('same pixels'),'source','material.png');
    assert.notEqual(other.saved.id,first.saved.id);assert.equal(other.images.length,2);
    const connection=await import(moduleUrl+'#reopened');
    const restored=await connection.readHistory();assert.equal(restored.length,2);
    assert.equal(restored.find(i=>i.kind==='target').name,'renamed.png');
    const removed=await removeImage(first.saved.id);assert.equal(removed.length,1);assert.equal(removed[0].kind,'source');
    for(let index=0;index<15;index++)await saveImage(canvas('unique '+index),'source','photo '+index);
    assert.equal((await readHistory()).length,HISTORY_LIMIT);
  } finally {globalThis.document=previousDocument;globalThis.indexedDB=previousDB;}
});
