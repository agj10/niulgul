import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
const outfile = fileURLToPath(new URL('../test-results/ui-test-bundle.mjs', import.meta.url));
await build({ stdin: { contents: "export { App } from './src/App'; export { ImageEditor } from './src/ImageEditor'; export { SampleGallery } from './src/SampleGallery'; export { ThemeControl } from './src/ThemeControl';", resolveDir: root, loader: 'tsx' }, outfile,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { 'import.meta.env.BASE_URL': '"/"' }, logLevel: 'silent' });
const { App, ImageEditor, SampleGallery, ThemeControl } = await import(pathToFileURL(outfile));
const noop = () => {};

test('result precedes photo inputs and the three transform controls with original defaults', () => {
  const previous = globalThis.document; globalThis.document = { baseURI: 'http://localhost/' };
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.ok(html.indexOf('aria-label="변환 결과"') < html.indexOf('aria-label="변환할 사진 선택"'));
    assert.ok(html.indexOf('재료 사진 업로드') < html.indexOf('얼굴 사진 업로드'));
    assert.ok(html.indexOf('얼굴 사진 업로드') < html.indexOf('aria-label="변환 설정"'));
    assert.equal((html.match(/type="range"/g)??[]).length,3);
    const strength = html.match(/aria-label="변환 강도" type="range" min="0" max="100" step="any" value="([^"]+)"/);
    assert.ok(strength);
    assert.equal(Number(strength[1]), 100 / 3);
    assert.match(html,/변환 강도<output>33<small>%/);
    assert.match(html,/aria-label="조각 크기" type="range" min="1" max="32" step="1" value="1"/);
    assert.match(html,/aria-label="색감과 명암" type="range" min="0" max="100" step="1" value="100"/);
    assert.match(html,/설정은 변환하기를 누르면 적용돼요/);
    assert.match(html,/시스템 테마/);assert.match(html,/라이트 테마/);assert.match(html,/다크 테마/);
    assert.match(html,/고양이 샘플/);assert.match(html,/오바마 샘플/);assert.match(html,/얼굴 샘플/);
    assert.match(html,/<h1>이 사진, <em>니 얼굴로\.<\/em><\/h1>/);
  } finally { globalThis.document = previous; }
});
test('editor exposes four independent corners, four stretch edges, crop bars, rotation and a single resolution slider', () => {
  const html = renderToStaticMarkup(createElement(ImageEditor,{ image:{canvas:{width:4032,height:3024},url:'data:image/png;base64,',name:'가족 사진.png',kind:'source'},onClose:noop,onApply:async()=>{} }));
  assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);
  assert.equal((html.match(/aria-label="[^"]*크기 조절"/g)??[]).length,4);
  assert.equal((html.match(/aria-label="[^"]*변 늘리기"/g)??[]).length,4);
  assert.equal((html.match(/aria-label="[^"]*자르기"/g)??[]).length,4);
  assert.match(html,/aria-label="사진 회전"/);assert.match(html,/aria-label="사진 이동"/);
  assert.equal((html.match(/type="range"/g)??[]).length,1);
  assert.doesNotMatch(html,/Shift:|드래그로 이동|위쪽 손잡이|editor-help|editor-frame-label|fill="white"|editor-live-image/);
  assert.match(html,/해상도가 높으면 얼굴화가 오래 걸려요/);
  assert.match(html,/고정 출력 프레임/);
  // Crop handles belong to the same transformed group as the image outline.
  assert.ok(html.indexOf('aria-label="위 자르기"') < html.indexOf('class="editor-frame"'));
  assert.match(html,/max="4032"/);assert.match(html,/value="256"/);
  assert.match(html,/좌우 반전/);assert.match(html,/상하 반전/);
});
test('each sample gallery contains only its own saved photos and offers deletion', () => {
  const history=[{id:'face',kind:'target',name:'얼굴.png',thumbnail:'data:face'},{id:'material',kind:'source',name:'재료.png',thumbnail:'data:source'}];
  const html=renderToStaticMarkup(createElement(SampleGallery,{kind:'target',samples:[{id:'portrait',name:'오바마',url:'/samples/portrait.png'}],history,selected:'face',disabled:false,onSample:noop,onHistory:noop,onRemove:noop}));
  assert.match(html,/오바마 샘플/);assert.match(html,/최근 사진 얼굴.png/);assert.doesNotMatch(html,/재료.png/);
  assert.match(html,/얼굴.png 기록 삭제/);assert.match(html,/class="selected"/);
});
test('theme control retains the saved user choice', () => {
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:()=> 'dark'};
  try {const html=renderToStaticMarkup(createElement(ThemeControl));assert.match(html,/aria-label="다크 테마" aria-pressed="true"/);}
  finally {globalThis.localStorage=previous;}
});
test('theme is applied before first paint and follows the system when storage is unavailable',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const [saved,system,expected] of [['light',true,'light'],['dark',false,'dark'],['system',true,'dark'],['invalid',false,'light'],[null,true,'dark'],['blocked',true,'dark']]) {
    const element={dataset:{}},meta={};
    runInNewContext(script,{localStorage:{getItem(){if(saved==='blocked')throw Error('disabled');return saved;}},matchMedia:()=>({matches:system}),document:{documentElement:element,querySelector:()=>meta}});
    assert.equal(element.dataset.appearance,expected);assert.equal(meta.content,expected==='dark'?'#181818':'#f7f7f2');
  }
});
