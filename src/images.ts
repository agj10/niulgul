import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Asset, FaceBox, PatchInput, Result, Settings } from './types';

export const assetUrl = (path: string) => new URL(import.meta.env.BASE_URL + path, document.baseURI).href;
let detectorPromise: Promise<FaceDetector> | undefined;
async function faceDetector() {
  detectorPromise ??= (async () => {
    const files = await FilesetResolver.forVisionTasks(assetUrl('vision'));
    return FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: assetUrl('models/face-detector.tflite'), delegate: 'CPU' },
      runningMode: 'IMAGE', minDetectionConfidence: 0.45,
    });
  })();
  try { return await detectorPromise; }
  catch (error) { detectorPromise = undefined; throw error; }
}

export function canvas(width: number, height: number) {
  const value = document.createElement('canvas');
  value.width = Math.max(1, Math.round(width)); value.height = Math.max(1, Math.round(height));
  return value;
}

async function inspect(image: HTMLCanvasElement) {
  try {
    const detector = await faceDetector();
    const detections = detector.detect(image).detections;
    const faces: FaceBox[] = detections.filter(d => d.boundingBox).map((d, id) => {
      const b = d.boundingBox!;
      const x = Math.max(0, b.originX - b.width * 0.16);
      const y = Math.max(0, b.originY - b.height * 0.3);
      return { id, x, y, width: Math.min(image.width - x, b.width * 1.32), height: Math.min(image.height - y, b.height * 1.5) };
    });
    return { faces, detection: 'ready' as const };
  } catch { return { faces: [], detection: 'unavailable' as const }; }
}

export async function fromCanvas(image: HTMLCanvasElement, name: string, id: string = crypto.randomUUID()): Promise<Asset> {
  const { faces, detection } = await inspect(image);
  const largest = [...faces].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return {
    id, name, canvas: image, url: image.toDataURL('image/jpeg', 0.88), faces, detection,
    targetCrop: largest ? { x: largest.x, y: largest.y, width: largest.width, height: largest.height } : undefined,
  };
}

export async function loadAsset(input: string | File, name?: string): Promise<Asset> {
  if (input instanceof File) {
    if (!input.type.startsWith('image/')) throw new Error('이미지 파일을 골라주세요.');
    if (input.size > 25 * 1024 * 1024) throw new Error('25MB 이하의 이미지를 골라주세요.');
  }
  const blob = input instanceof File ? input : await fetch(input).then(r => {
    if (!r.ok) throw new Error('예시 이미지를 불러오지 못했어요.');
    return r.blob();
  });
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { throw new Error('이 이미지는 읽을 수 없어요. JPG, PNG, WebP 파일로 다시 시도해주세요.'); }
  const output = canvas(bitmap.width, bitmap.height);
  const ctx = output.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(bitmap, 0, 0, output.width, output.height); bitmap.close();
  return fromCanvas(output, name ?? (input instanceof File ? input.name : '이미지'));
}

const materialCache = new WeakMap<Asset, HTMLCanvasElement>();
export function materialBase(source: Asset, scope: 'whole' | 'faces') {
  if (scope === 'faces' || source.canvas.width === source.canvas.height) return source.canvas;
  let base = materialCache.get(source);
  if (!base) {
    const side = Math.min(source.canvas.width, source.canvas.height);
    base = canvas(side, side);
    base.getContext('2d')!.drawImage(source.canvas, Math.floor((source.canvas.width - side) / 2), Math.floor((source.canvas.height - side) / 2), side, side, 0, 0, side, side);
    materialCache.set(source, base);
  }
  return base;
}

export function makePatches(source: Asset, target: Asset, settings: Settings, scope: 'whole' | 'faces', selected: number[], _previous?: Result): PatchInput[] {
  const base = materialBase(source, scope);
  const rects = scope === 'whole' ? [{ x: 0, y: 0, width: base.width, height: base.height }]
    : source.faces.filter(face => selected.includes(face.id)).map(face => {
      const side = Math.min(Math.ceil(Math.max(face.width, face.height)), base.width, base.height);
      return { x: Math.max(0, Math.min(base.width - side, Math.round(face.x + face.width / 2 - side / 2))),
        y: Math.max(0, Math.min(base.height - side, Math.round(face.y + face.height / 2 - side / 2))), width: side, height: side };
    });
  const crop = !target.builtinTarget && target.targetCrop ? target.targetCrop
    : { x: 0, y: 0, width: target.canvas.width, height: target.canvas.height };
  const face = canvas(crop.width, crop.height);
  face.getContext('2d')!.drawImage(target.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, face.width, face.height);
  const rawTarget = { width: face.width, height: face.height, data: face.getContext('2d')!.getImageData(0, 0, face.width, face.height).data };
  return rects.map(rect => {
    const tile = canvas(rect.width, rect.height);
    const side = Math.max(1, Math.round(Math.min(tile.width, tile.height) / (settings.cellSize ?? 1)));
    tile.getContext('2d')!.drawImage(base, rect.x, rect.y, rect.width, rect.height, 0, 0, tile.width, tile.height);
    return {
      rect, width: side, height: side,
      source: new Uint8ClampedArray(side ** 2 * 4), target: new Uint8ClampedArray(side ** 2 * 4),
      rawSource: { width: tile.width, height: tile.height, data: tile.getContext('2d')!.getImageData(0, 0, tile.width, tile.height).data },
      rawTarget, builtinTarget: target.builtinTarget,
    };
  });
}

