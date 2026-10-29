import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FlipHorizontal2, FlipVertical2, RotateCcw, X } from 'lucide-react';
import { dragEdit, editorBounds, initialEdit, outputSize, renderEdit, type Corner, type Edge, type Gesture, type ImageEdit, type Point } from './editor-geometry';

export type EditorImage = { canvas: HTMLCanvasElement; name: string; url: string; kind: 'source' | 'target'; camera?: boolean; output?: { width: number; height: number } };
const corners: Corner[] = ['nw', 'ne', 'se', 'sw'];
const edges: Edge[] = ['n', 'e', 's', 'w'];
const edgeName = { n: '위', e: '오른쪽', s: '아래', w: '왼쪽' };
const cornerName = { nw: '왼쪽 위', ne: '오른쪽 위', se: '오른쪽 아래', sw: '왼쪽 아래' };

export function ImageEditor({ image, onClose, onApply }: { image: EditorImage; onClose(): void; onApply(canvas: HTMLCanvasElement): Promise<void> }) {
  const [initial] = useState(() => initialEdit(image.canvas.width, image.canvas.height, image.output?.width, image.output?.height));
  const [edit, setEdit] = useState(initial);
  const maximum = Math.max(image.canvas.width, image.canvas.height), minimum = Math.min(32, maximum);
  const [resolution, setResolution] = useState(Math.min(256, maximum));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [stageSize, setStageSize] = useState({ width: 640, height: 460 });
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), preview = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ edit: ImageEdit; type: Gesture; start: Point; aspect: number; id: number } | undefined>(undefined);
  const savingRef = useRef(false), close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const size = outputSize(edit.frame, resolution), frame = edit.frame, object = edit.image;
  // Do not refit after a gesture: the output frame must stay still on screen.
  const viewport = editorBounds(initial, stageSize.width, stageSize.width / stageSize.height);
  const unit = viewport.width / stageSize.width;
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(svg.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => { gesture.current = undefined; }, [stageSize.width, stageSize.height]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; root.current?.focus();
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) close.current();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', listener); previous?.focus(); };
  }, []);
  useEffect(() => {
    // Preview uses the chosen output dimensions, so resolution changes are visible immediately.
    const output = preview.current!;
    const rendered = renderEdit(image.canvas, edit, Math.min(resolution, 640));
    output.width = rendered.width; output.height = rendered.height;
    output.getContext('2d')!.drawImage(rendered, 0, 0);
  }, [edit, resolution, image]);
  function point(event: PointerEvent): Point {
    const p = svg.current!.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  }
  function begin(event: PointerEvent, type: Gesture) {
    if (saving || gesture.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    gesture.current = { edit, type, start: point(event), aspect: edit.image.width / edit.image.height, id: event.pointerId };
    svg.current!.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const current = gesture.current;
    if (current?.id === event.pointerId) setEdit(dragEdit(current.edit, current.type, current.start, point(event), event.shiftKey ? current.aspect : undefined));
  }
  function end(event: PointerEvent) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = undefined;
    if (svg.current!.hasPointerCapture(event.pointerId)) svg.current!.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent, type: Gesture) {
    if (saving || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 2) * unit;
    const delta = { x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0 };
    const updated = type === 'rotate' ? { ...edit, image: { ...object, angle: object.angle + ((delta.x || -delta.y) > 0 ? 1 : -1) * (event.shiftKey ? 15 : 1) } }
      : dragEdit(edit, type, { x: 0, y: 0 }, delta, event.shiftKey ? object.width / object.height : undefined);
    setEdit(updated);
  }
  const handle = (label: string, type: Gesture) => ({ role: 'button' as const, tabIndex: saving ? -1 : 0, 'aria-label': label,
    onPointerDown: (event: PointerEvent) => begin(event, type), onKeyDown: (event: KeyboardEvent) => keyboard(event, type) });
  async function apply() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try { await onApply(renderEdit(image.canvas, edit, resolution)); }
    catch (value) { setError(value instanceof Error ? value.message : '사진을 적용하지 못했어요.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <div className="editor-backdrop"><div ref={root} className="image-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="editor-header"><div><h2 id={titleId}>이미지 설정</h2><p>{image.kind === 'source' ? '재료 사진' : '얼굴 사진'} · {image.name}</p></div>
      <button className="icon-button" onClick={onClose} disabled={saving} aria-label="이미지 설정 닫기"><X size={20} /></button></header>
    <div className="editor-scroll">
      <div className="editor-workbench"><svg ref={svg} className="editor-canvas" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        aria-label="이미지 편집 영역" onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        <g pointerEvents="none" transform={`translate(${object.x} ${object.y}) rotate(${object.angle}) scale(${object.flipX ? -1 : 1} ${object.flipY ? -1 : 1})`}>
          <svg x={-object.width / 2} y={-object.height / 2} width={object.width} height={object.height} overflow="hidden" preserveAspectRatio="none"
            viewBox={`${edit.crop.x * image.canvas.width} ${edit.crop.y * image.canvas.height} ${edit.crop.width * image.canvas.width} ${edit.crop.height * image.canvas.height}`}>
            <image href={image.url} width={image.canvas.width} height={image.canvas.height} /></svg></g>
        <g transform={`translate(${object.x} ${object.y}) rotate(${object.angle})`}>
          <rect className="editor-object" x={-object.width / 2} y={-object.height / 2} width={object.width} height={object.height}
            {...handle('사진 이동', 'move')} />
          {edges.map(edge => {
            const vertical = edge === 'e' || edge === 'w', x = edge === 'w' ? -object.width / 2 : edge === 'e' ? object.width / 2 : 0,
              y = edge === 'n' ? -object.height / 2 : edge === 's' ? object.height / 2 : 0;
            return <rect key={edge} className={'editor-stretch ' + (vertical ? 'horizontal' : 'vertical')}
              x={vertical ? x - 7 * unit : -object.width / 2 + 12 * unit} y={vertical ? -object.height / 2 + 12 * unit : y - 7 * unit}
              width={vertical ? 14 * unit : Math.max(0, object.width - 24 * unit)} height={vertical ? Math.max(0, object.height - 24 * unit) : 14 * unit}
              {...handle(edgeName[edge] + ' 변 늘리기', `resize-${edge}`)} />;
          })}
          <line className="editor-rotation-line" x1="0" y1={-object.height / 2} x2="0" y2={-object.height / 2 - 34 * unit} />
          <g className="editor-rotation" {...handle('사진 회전', 'rotate')}><circle className="editor-hit" cx="0" cy={-object.height / 2 - 34 * unit} r={22 * unit} />
            <circle className="editor-knob" cx="0" cy={-object.height / 2 - 34 * unit} r={7 * unit} /><path className="editor-rotation-mark" d={`M ${-3 * unit} ${-object.height / 2 - 35 * unit} a ${3.5 * unit} ${3.5 * unit} 0 1 1 0 ${4 * unit}`} /></g>
          {corners.map(corner => {
            const x = (corner.includes('e') ? 1 : -1) * object.width / 2, y = (corner.includes('s') ? 1 : -1) * object.height / 2;
            return <g key={corner} className={'editor-corner ' + corner} {...handle(cornerName[corner] + ' 크기 조절', `resize-${corner}`)}>
              <circle className="editor-hit" cx={x} cy={y} r={22 * unit} /><circle className="editor-knob" cx={x} cy={y} r={5 * unit} /></g>;
          })}
          {edges.map(edge => {
            const vertical = edge === 'e' || edge === 'w', x = edge === 'w' ? -object.width / 2 : edge === 'e' ? object.width / 2 : 0,
              y = edge === 'n' ? -object.height / 2 : edge === 's' ? object.height / 2 : 0;
            return <g key={edge} className={'editor-crop ' + (vertical ? 'horizontal' : 'vertical')} {...handle(edgeName[edge] + ' 자르기', `crop-${edge}`)}>
              <rect className="editor-hit" x={x - 22 * unit} y={y - 22 * unit} width={44 * unit} height={44 * unit} />
              <rect className="editor-crop-bar" x={x - (vertical ? 3 : 14) * unit} y={y - (vertical ? 14 : 3) * unit}
                width={(vertical ? 6 : 28) * unit} height={(vertical ? 28 : 6) * unit} rx={2 * unit} /></g>;
          })}
        </g>
        <rect className="editor-frame" {...frame} aria-label="고정 출력 프레임" />
      </svg></div>
      <div className="editor-tools"><div className="flip-tools"><button className="secondary-button" aria-pressed={object.flipX} disabled={saving} onClick={() => setEdit({ ...edit, image: { ...object, flipX: !object.flipX } })}><FlipHorizontal2 size={16} />좌우 반전</button>
        <button className="secondary-button" aria-pressed={object.flipY} disabled={saving} onClick={() => setEdit({ ...edit, image: { ...object, flipY: !object.flipY } })}><FlipVertical2 size={16} />상하 반전</button></div>
        <button className="editor-reset" disabled={saving} onClick={() => { setEdit(initial); setResolution(Math.min(256, maximum)); }}><RotateCcw size={14} />초기화</button></div>
      <div className="editor-bottom"><label className="resolution-control"><span>해상도<output>{size.width} × {size.height} px</output></span>
        <input type="range" aria-label="이미지 해상도" min={minimum} max={maximum} step="1" value={resolution} disabled={saving} onChange={event => setResolution(+event.target.value)} />
        <span className="resolution-ends"><small>{minimum}px</small><small>원본 {maximum}px</small></span></label>
        <div className="editor-result"><canvas ref={preview} aria-label="적용될 이미지 미리보기" /><span>결과 미리보기</span></div>
        <p className="resolution-note">해상도가 높으면 얼굴화가 오래 걸려요.</p>
      </div>
      {error && <p className="input-error" role="alert">{error}</p>}
    </div>
    <footer className="editor-footer"><button className="secondary-button" disabled={saving} onClick={onClose}>취소</button><button className="primary-button" disabled={saving} onClick={() => void apply()}>{saving ? <><span className="spinner" />사진 준비 중…</> : '적용하기'}</button></footer>
  </div></div>;
}
