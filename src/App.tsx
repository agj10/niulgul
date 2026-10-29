import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUpRight, Camera, Check, ChevronRight, Github, ImagePlus, ScanFace, Upload, X } from 'lucide-react';
import { loadAsset, assetUrl, makePatches, capture, fromCanvas, canvas, materialBase } from './images';
import { loadOriginalCore, ORIGINAL_SETTINGS } from './original-core';
import { Matcher } from './matcher';
import { LatestJobs } from './jobs';
import { drawFinal, drawAnimation, FluidRenderer } from './render';
import { Simulation, SIMULATION_STEPS } from './simulation';
import type { Asset, Settings, Result } from './types';

type Mode = 'photo' | 'camera';
type Scope = 'whole' | 'faces';
type Phase = 'ready' | 'loading' | 'calculating' | 'animating' | 'done' | 'error';
type Input = { source: Asset; target: Asset; settings: Settings; scope: Scope; animate: boolean; epoch: number };
const SAMPLES = [{ id: 'colors', name: '컬러' }, { id: 'cat', name: '고양이' }, { id: 'space', name: '우주' }, { id: 'tree', name: '나무' }];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function UploadBox({ kind, asset, loading, onFile }: { kind: 'source' | 'target'; asset?: Asset; loading: boolean; onFile(file: File): void }) {
  const [dragging, setDragging] = useState(false);
  const title = kind === 'source' ? '재료 사진' : '얼굴 사진';
  return <label className={'upload ' + (dragging ? 'is-dragging ' : '') + (loading ? 'is-loading' : '')}
    onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
    <div className="upload-thumbnail">{asset ? <img src={asset.url} alt={'선택한 ' + title} /> : <ImagePlus size={24} strokeWidth={1.4} />}</div>
    <span className="upload-copy"><strong>{loading ? '사진 불러오는 중…' : asset?.name ?? '사진 선택하기'}</strong>
      <small>{dragging ? '여기에 놓아 주세요' : '클릭하거나 사진을 끌어놓으세요'}</small></span><Upload size={15} className="upload-icon" />
    <input aria-label={title + ' 업로드'} type="file" accept="image/*" disabled={loading}
      onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ''; }} />
  </label>;
}
export function App() {
  const [source, setSource] = useState<Asset>(), [target, setTarget] = useState<Asset>();
  const [cameraTarget, setCameraTarget] = useState<Asset>();
  const [mode, setMode] = useState<Mode>('photo'), [scope, setScope] = useState<Scope>('whole');
  const [settings, setSettings] = useState<Settings>({ ...ORIGINAL_SETTINGS });
  const [phase, setPhase] = useState<Phase>('loading'), [message, setMessage] = useState('샘플 사진을 준비하고 있어요.');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [result, setResult] = useState<Result>();
  const [cameraReady, setCameraReady] = useState(false), [cameraCapturing, setCameraCapturing] = useState(false);
  const [cameraPending, setCameraPending] = useState(false), [cameraError, setCameraError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false), [targetLoading, setTargetLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null), [showOriginal, setShowOriginal] = useState(false);
  const output = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined), matcher = useRef<Matcher | undefined>(undefined);
  const queue = useRef<LatestJobs<Input, Result> | undefined>(undefined), resultRef = useRef<Result | undefined>(undefined);
  const selectedTarget = mode === 'camera' ? cameraTarget : target;
  const input = useRef({ source, target: selectedTarget, settings, scope, mode });
  const active = useRef(false), mounted = useRef(true), epoch = useRef(0), captureRevision = useRef(0);
  const animation = useRef<{ cancel(): void } | undefined>(undefined), exporter = useRef<Worker | undefined>(undefined);
  const uploadRevision = useRef({ source: 0, target: 0 }), imageRevision = useRef(''), needsAnimation = useRef(false);
  input.current = { source, target: selectedTarget, settings, scope, mode };

  function fail(value: unknown) {
    setPhase('error'); setMessage(value instanceof Error ? value.message : '변환하지 못했어요. 다시 시도해 주세요.');
  }
  function request(animate = false) {
    const current = input.current;
    if (!current.source || !current.target) return;
    needsAnimation.current ||= animate;
    animation.current?.cancel(); setShowOriginal(false);
    queue.current?.request({ source: current.source, target: current.target, settings: current.settings,
      scope: current.scope, animate: needsAnimation.current, epoch: epoch.current });
  }
  function present(value: Result, animate: boolean): Promise<void> {
    const element = output.current!;
    const scale = 640 / Math.max(value.base.width, value.base.height);
    element.width = Math.round(value.base.width * scale); element.height = Math.round(value.base.height * scale);
    const patches = value.patches.map(patch => ({ ...patch, rect: {
      x: patch.rect.x * scale, y: patch.rect.y * scale,
      width: patch.rect.width * scale, height: patch.rect.height * scale,
    } }));
    const context = element.getContext('2d')!;
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawFinal(context, value.base, element.width, element.height, patches); return Promise.resolve();
    }
    setPhase('animating'); setMessage('조각들이 제자리를 찾아가는 중');
    return loadOriginalCore(assetUrl('engine/original.wasm')).then(() => new Promise<void>(resolve => {
      let frameId = 0, finished = false, renderer: FluidRenderer;
      try { renderer = new FluidRenderer(Math.max(1024, ...patches.map(p => p.width))); } catch { drawFinal(context, value.base, element.width, element.height, patches); resolve(); return; }
      const simulations = patches.map(patch => new Simulation(patch)), start = performance.now();
      const finish = () => {
        if (finished) return;
        finished = true; cancelAnimationFrame(frameId); renderer.dispose();
        // Keep the actual last frame; do not force the particles onto a grid.
        animation.current = undefined; resolve();
      };
      animation.current = { cancel: finish };
      const frame = () => {
        if (finished) return;
        const step = Math.min(SIMULATION_STEPS, Math.round((performance.now() - start) / 1000 * 60));
        drawAnimation(context, value.base, element.width, element.height, patches, simulations, renderer, step);
        if (step >= SIMULATION_STEPS || (step > 180 && simulations.every(sim => sim.settled))) { finish(); return; }
        frameId = requestAnimationFrame(frame);
      };
      frameId = requestAnimationFrame(frame);
    }));
  }
  useEffect(() => {
    mounted.current = true; matcher.current = new Matcher();
    queue.current = new LatestJobs<Input, Result>({
      async run(job) {
        setPhase('calculating'); setProgress(0); setMessage('사진 속 색으로 얼굴의 배치를 계산하고 있어요.');
        const face = job.target;
        const patches = makePatches(job.source, face, job.settings, job.scope, job.source.faces.map(item => item.id), resultRef.current);
        if (!patches.length) throw new Error(job.source.detection === 'unavailable'
          ? '얼굴 감지기를 불러오지 못했어요. 사진 전체로 시도해 주세요.'
          : '재료 사진에서 얼굴을 찾지 못했어요. 다른 사진을 고르거나 사진 전체로 시도해 주세요.');
        const answer = await matcher.current!.solve(patches, job.settings, setProgress);
        return {
          key: crypto.randomUUID(), sourceId: job.source.id, targetId: face.id, base: materialBase(job.source, job.scope), target: face.canvas,
          patches: patches.map((patch, i) => ({ ...patch, source: answer.sources[i], assignment: answer.assignments[i] })),
          duration: answer.duration, settings: job.settings,
        };
      },
      async publish(value, job) {
        if (job.epoch !== epoch.current) return;
        resultRef.current = value; setResult(value); setShowOriginal(false); needsAnimation.current = false;
        await present(value, job.animate);
        if (!mounted.current || job.epoch !== epoch.current) return;
        setPhase('done'); setProgress(1);
        setMessage('완성했어요 · 계산 ' + (value.duration / 1000).toFixed(2) + '초');
      },
      error(value) { fail(value); },
      busy(value) { if (mounted.current) setBusy(value); },
      idle() {},
    });
    Promise.all([loadAsset(assetUrl('samples/cat.png'), '고양이'), loadAsset(assetUrl('samples/portrait.png'), '샘플 얼굴')])
      .then(([material, face]) => { if (!mounted.current) return; face.builtinTarget = true; setSource(material); setTarget(face); setPhase('ready'); setMessage('사진을 골랐다면, 변환하기를 눌러 보세요.'); })
      .catch(value => mounted.current && fail(value));
    return () => {
      mounted.current = false; captureRevision.current++; animation.current?.cancel();
      queue.current?.dispose(); matcher.current?.dispose(); exporter.current?.terminate(); stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!source) return;
    const key = source.id + ':' + selectedTarget?.id + ':' + mode, changedImage = imageRevision.current !== key;
    imageRevision.current = key;
    if (!active.current) {
      if (!resultRef.current) {
        const element = output.current!; element.width = source.canvas.width; element.height = source.canvas.height;
        element.getContext('2d')!.drawImage(source.canvas, 0, 0);
      }
      return;
    }
    const timer = setTimeout(() => request(changedImage), changedImage ? 0 : 100);
    return () => clearTimeout(timer);
  }, [source, selectedTarget, settings, scope, mode]);
  async function choose(value: File | string, kind: 'source' | 'target', name?: string) {
    const revision = ++uploadRevision.current[kind], loading = kind === 'source' ? setSourceLoading : setTargetLoading;
    loading(true);
    try {
      const asset = await loadAsset(value, name);
      if (!mounted.current || revision !== uploadRevision.current[kind]) return;
      if (kind === 'source') setSource(asset); else setTarget(asset);
      if (!active.current) { setPhase('ready'); setMessage('준비됐다면, 변환하기를 눌러 주세요.'); }
    } catch (value) { if (revision === uploadRevision.current[kind]) fail(value); }
    finally { if (revision === uploadRevision.current[kind]) loading(false); }
  }
  async function openCamera() {
    const openedEpoch = epoch.current;
    setCameraPending(true); setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요.');
      stream.current?.getTracks().forEach(track => track.stop());
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!mounted.current || openedEpoch !== epoch.current || input.current.mode !== 'camera') { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const element = video.current!; element.srcObject = media; await element.play();
      if (!mounted.current || openedEpoch !== epoch.current) { media.getTracks().forEach(track => track.stop()); return; }
      setCameraReady(true);
      media.getVideoTracks()[0].onended = () => { if (stream.current === media) setCameraReady(false); };
    } catch (value) {
      if (!mounted.current || openedEpoch !== epoch.current) return;
      stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined;
      setCameraReady(false);
      const name = value instanceof Error ? value.name : '';
      setCameraError(name === 'NotAllowedError' ? '카메라 사용을 허용해 주세요. 사진 모드도 사용할 수 있어요.'
        : name === 'NotFoundError' ? '연결된 카메라를 찾지 못했어요.'
        : name === 'NotReadableError' ? '다른 앱이 카메라를 사용 중인지 확인해 주세요.'
        : value instanceof Error ? value.message : '카메라를 열지 못했어요.');
    } finally { if (mounted.current && openedEpoch === epoch.current) setCameraPending(false); }
  }
  async function takeSnapshot() {
    if (!cameraReady || !video.current || !stream.current?.active || cameraCapturing) return;
    const revision = ++captureRevision.current, capturedEpoch = epoch.current;
    setCameraCapturing(true); setCameraError('');
    try {
      const image = capture(video.current);
      const asset = await fromCanvas(image, '촬영한 얼굴', 'camera-' + crypto.randomUUID());
      if (!mounted.current || revision !== captureRevision.current || capturedEpoch !== epoch.current) return;
      setCameraTarget(asset);
      if (!active.current) { setPhase('ready'); setMessage('촬영한 얼굴을 넣었어요. 변환하기를 눌러 주세요.'); }
    } catch (value) {
      if (mounted.current && revision === captureRevision.current && capturedEpoch === epoch.current)
        setCameraError(value instanceof Error ? value.message : '촬영하지 못했어요. 다시 눌러 주세요.');
    } finally {
      if (mounted.current && revision === captureRevision.current && capturedEpoch === epoch.current) setCameraCapturing(false);
    }
  }
  function changeMode(value: Mode) {
    if (value === mode) return;
    active.current = false; epoch.current++; captureRevision.current++; needsAnimation.current = false;
    queue.current?.invalidate(); animation.current?.cancel(); setMode(value); setCameraPending(false); setCameraCapturing(false);
    if (value === 'photo') { stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; setCameraReady(false); }
    setCameraError('');
    setPhase(resultRef.current ? 'done' : 'ready');
    setMessage(value === 'camera' ? (cameraTarget ? '촬영한 얼굴로 변환하거나 다시 촬영해 주세요.' : '카메라를 켜고 현재 화면을 촬영해 주세요.') : '사진을 골랐다면, 변환하기를 눌러 주세요.');
  }
  function start() {
    const previous = resultRef.current;
    const changedImage = !previous || previous.sourceId !== source?.id
      || previous.targetId !== selectedTarget?.id;
    active.current = true;
    request(changedImage);
  }
  async function savePNG() {
    const value = resultRef.current; if (!value) return;
    const image = canvas(value.base.width, value.base.height);
    drawFinal(image.getContext('2d')!, value.base, image.width, image.height, value.patches);
    image.toBlob(blob => blob ? download(blob, 'niulgul.png') : fail(new Error('이미지를 저장하지 못했어요.')), 'image/png');
  }
  async function saveGIF() {
    const value = resultRef.current; if (!value || exportProgress !== null) return;
    setExportProgress(0);
    try {
      const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' }); exporter.current = worker;
      const finish = () => { worker.terminate(); exporter.current = undefined; setExportProgress(null); };
      worker.onmessage = event => {
        if (event.data.type === 'progress') setExportProgress(event.data.progress);
        if (event.data.type === 'done') { download(new Blob([event.data.bytes], { type: 'image/gif' }), 'niulgul.gif'); finish(); }
        if (event.data.type === 'error') { fail(new Error(event.data.message)); finish(); }
      };
      worker.onerror = () => { fail(new Error('GIF를 만들지 못했어요. 다시 시도해 주세요.')); finish(); };
      const base = await createImageBitmap(value.base);
      worker.postMessage({ base, patches: value.patches, width: value.base.width, height: value.base.height, engineUrl: assetUrl('engine/original.wasm') }, [base]);
    } catch (value) { exporter.current?.terminate(); setExportProgress(null); fail(value); }
  }
  const canStart = source && selectedTarget && !sourceLoading && !targetLoading && !cameraCapturing;
  const readyToSave = !!result && !busy && !sourceLoading && !targetLoading;
  const fill = (value: number) => ({ '--fill': value + '%' } as CSSProperties);
  return <>
    <header className="site-header"><a className="brand" href="./" aria-label="niulgul 처음으로"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>niulgul<span className="brand-period">.</span></a>
      <a className="github-link" href="https://github.com/agj10/niulgul" target="_blank" rel="noreferrer"><Github size={16} /><span>GitHub</span><ArrowUpRight size={13} /></a></header>
    <main><div className="intro"><p>사진으로 노는 작은 작업실</p><h1>이 사진, <em>니 얼굴로.</em></h1><span>사진의 색은 그대로, 조각들의 자리를 바꿔 새로운 얼굴을 만들어요.</span></div>
      <div className="workspace"><aside className="inputs" aria-label="변환할 사진 선택">
        <section className="input-section"><h2><span className="step">01</span>재료 사진<span className="section-caption">이 사진을 바꿀 거예요</span></h2>
          <UploadBox kind="source" asset={source} loading={sourceLoading} onFile={file => void choose(file, 'source')} />
          <div className="sample-list" aria-label="재료 샘플">{SAMPLES.map(sample => <button key={sample.id} title={sample.name + ' 샘플'} aria-label={sample.name + ' 샘플'} className={source?.name === sample.name ? 'selected' : ''}
            onClick={() => void choose(assetUrl('samples/' + sample.id + '.png'), 'source', sample.name)}><img src={assetUrl('samples/' + sample.id + '.png')} alt="" /><span>{sample.name}</span>{source?.name === sample.name && <i><Check size={10} /></i>}</button>)}</div>
        </section>
        <section className="input-section"><h2><span className="step">02</span>어떤 얼굴로?</h2>
          <div className="tabs" role="group" aria-label="얼굴 입력 방식"><button aria-pressed={mode === 'photo'} className={mode === 'photo' ? 'active' : ''} onClick={() => changeMode('photo')}><ImagePlus size={14} />사진</button>
            <button aria-pressed={mode === 'camera'} className={mode === 'camera' ? 'active' : ''} onClick={() => changeMode('camera')}><Camera size={14} />카메라</button></div>
          {mode === 'photo' ? <UploadBox kind="target" asset={target} loading={targetLoading} onFile={file => void choose(file, 'target')} /> : <div className="camera-input">
            <div className={'camera-preview ' + (cameraReady ? 'is-ready' : '')}>
              <video ref={video} muted playsInline aria-label="목표 얼굴 카메라 미리보기" />
              {!cameraReady && <div className="camera-prompt"><Camera size={25} strokeWidth={1.2} /><p>지금의 표정을 얼굴로</p><button className="secondary-button" disabled={cameraPending} onClick={openCamera}>{cameraPending ? '카메라 연결 중…' : '카메라 켜기'}</button></div>}
              {cameraReady && <span className="camera-badge"><span />촬영 미리보기</span>}
            </div>
            <button className="capture-button" disabled={!cameraReady || cameraCapturing} onClick={takeSnapshot}>
              {cameraCapturing ? <span className="spinner" /> : <Camera size={14} />}{cameraCapturing ? '사진 준비 중…' : cameraTarget ? '다시 촬영하기' : '현재 화면 촬영하기'}
            </button>
            {cameraTarget ? <div className="camera-snapshot"><img src={cameraTarget.url} alt="촬영한 얼굴 사진" /><span><strong>촬영한 얼굴</strong><small>이 사진으로 변환해요.</small></span><Check size={14} /></div>
              : <p className="camera-hint">버튼을 누른 순간의 화면을 사용해요.</p>}
          </div>}
          {cameraError && <p className="input-error" role="alert">{cameraError}</p>}
        </section>
        <section className="input-section scope-section"><h2><span className="step">03</span>어디까지 바꿀까요?</h2>
          <div className="scope-options" role="group" aria-label="적용 영역"><button className={scope === 'whole' ? 'active' : ''} aria-pressed={scope === 'whole'} onClick={() => setScope('whole')}><span className="scope-whole" />사진 전체<Check size={13} /></button>
            <button className={scope === 'faces' ? 'active' : ''} aria-pressed={scope === 'faces'} onClick={() => setScope('faces')}><ScanFace size={17} />얼굴 부분만<Check size={13} /></button></div>
          {scope === 'faces' && <p className="scope-hint">{source?.detection === 'unavailable' ? '얼굴 감지기를 불러오지 못했어요.' : source?.faces.length ? source.faces.length + '개의 얼굴을 찾았어요. 배경은 그대로 두어요.' : '이 사진에서는 얼굴을 찾지 못했어요.'}</p>}
        </section>
        <button className="primary-button" disabled={!canStart || busy || (scope === 'faces' && !source?.faces.length)} onClick={start}>{busy ? <><span className="spinner" />{phase === 'animating' ? '얼굴을 만드는 중' : '배치를 계산하는 중'}</> : <>{result ? '다시 변환하기' : '변환하기'}<ArrowUpRight size={19} /></>}</button>
        <p className="local-note">사진은 브라우저 안에서만 처리해요.</p>
      </aside>
      <article className="output-panel" aria-label="변환 결과"><div className="stage-header"><div className="stage-title"><span className="status-dot" />{result ? '새로운 니얼굴' : '곧, 다른 얼굴이 될 사진'}</div>
        {result ? <button className={'compare-button ' + (showOriginal ? 'active' : '')} aria-pressed={showOriginal} disabled={busy} onClick={() => setShowOriginal(value => !value)}>{showOriginal ? '결과 보기' : '원본 보기'}<ChevronRight size={12} /></button> : <span className="stage-label">PREVIEW</span>}</div>
        <div className={'stage ' + (phase === 'calculating' ? 'is-calculating' : '')} aria-busy={busy}>
          <canvas ref={output} role="img" aria-label={result ? '사진의 픽셀을 재배치한 얼굴 결과' : '변환 전 재료 사진'} style={{ visibility: showOriginal ? 'hidden' : 'visible' }} />
          {showOriginal && result && <img className="original-overlay" src={result.base.toDataURL()} alt="변환 전 원본" />}
          {phase === 'calculating' && <div className="computation-badge"><span className="spinner" />배치를 계산하고 있어요<span>{Math.round(progress * 100)}%</span></div>}
          <span className="stage-corner top-left" /><span className="stage-corner bottom-right" />
        </div>
        <div className="result-toolbar"><span className={'result-status ' + (phase === 'error' ? 'error' : '')} role="status" aria-live="polite">{phase === 'done' && <Check size={12} />}{message}</span>
          <div className="save-actions"><button disabled={!readyToSave} onClick={savePNG} title="현재 결과 이미지를 PNG로 저장">PNG<ArrowDown size={13} /></button>
            <button disabled={!readyToSave || exportProgress !== null} onClick={saveGIF} title="원본 1초 → 다각형 재배치 → 결과 1초로 GIF 저장">{exportProgress === null ? 'GIF' : Math.round(exportProgress * 100) + '%'}<ArrowDown size={13} /></button>
            {exportProgress !== null && <button className="cancel-export" aria-label="GIF 저장 취소" onClick={() => { exporter.current?.terminate(); setExportProgress(null); }}><X size={12} /></button>}</div></div>
        <div className="settings" aria-label="변환 설정">
          <label className="slider-control"><span>변환 강도<output>{settings.strength}<small>%</small></output></span><input aria-label="변환 강도" type="range" min={0} max={100} value={settings.strength} style={fill(settings.strength)} onChange={e => setSettings(value => ({ ...value, strength: +e.target.value }))} /><span className="slider-ends"><small>원본에 가깝게</small><small>얼굴에 가깝게</small></span></label>
          <label className="slider-control"><span>조각 크기<output>{settings.cellSize ?? 1}<small> px</small></output></span><input aria-label="조각 크기" type="range" min={1} max={32} step={1} value={settings.cellSize ?? 1} style={fill(((settings.cellSize ?? 1) - 1) / 31 * 100)} onChange={e => setSettings(value => ({ ...value, cellSize: +e.target.value }))} /><span className="slider-ends"><small>잘게</small><small>큼직하게</small></span></label>
          <label className="slider-control"><span>표현 방식<output>{settings.tone < 35 ? '명암' : settings.tone > 65 ? '색감' : '균형'}</output></span><input aria-label="색감과 명암" type="range" min={0} max={100} value={settings.tone} style={fill(settings.tone)} onChange={e => setSettings(value => ({ ...value, tone: +e.target.value }))} /><span className="slider-ends"><small>명암 중심</small><small>색감 중심</small></span></label>
        </div>
      </article></div>
      <footer><span>같은 조각, 다른 얼굴.</span><span>Built on <a href="https://github.com/Spu7Nix/obamify" target="_blank" rel="noreferrer">Spu7Nix / obamify<ArrowUpRight size={10} /></a></span></footer>
    </main></>;
}

