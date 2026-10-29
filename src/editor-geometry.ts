export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type ImageTransform = Rect & { angle: number; flipX: boolean; flipY: boolean };
export type ImageEdit = { image: ImageTransform; frame: Rect };
export type Edge = 'n' | 'e' | 's' | 'w';
export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export type Gesture = 'move' | 'rotate' | `resize-${Corner | Edge}` | `crop-${Edge}`;

const MIN = 12;
export function initialEdit(width: number, height: number): ImageEdit {
  const scale = Math.min(440 / width, 290 / height);
  const w = width * scale, h = height * scale;
  return { image: { x: 320, y: 230, width: w, height: h, angle: 0, flipX: false, flipY: false },
    frame: { x: 320 - w / 2, y: 230 - h / 2, width: w, height: h } };
}
export function rotate(point: Point, angle: number): Point {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}
export function imagePoint(image: ImageTransform, x: number, y: number): Point {
  const point = rotate({ x, y }, image.angle);
  return { x: image.x + point.x, y: image.y + point.y };
}
/** Frozen gesture geometry keeps the opposite corner/edge anchored, including after rotation. */
export function dragEdit(initial: ImageEdit, gesture: Gesture, start: Point, point: Point, aspect?: number): ImageEdit {
  const edit = structuredClone(initial), image = edit.image;
  const dx = point.x - start.x, dy = point.y - start.y;
  if (gesture === 'move') { image.x += dx; image.y += dy; return edit; }
  if (gesture === 'rotate') {
    const a = Math.atan2(start.y - image.y, start.x - image.x), b = Math.atan2(point.y - image.y, point.x - image.x);
    image.angle = ((image.angle + (b - a) * 180 / Math.PI) % 360 + 540) % 360 - 180;
    return edit;
  }
  const edge = gesture.split('-')[1];
  if (gesture.startsWith('crop-')) {
    const f = edit.frame;
    if (edge === 'w') { const amount = Math.min(dx, f.width - MIN); f.x += amount; f.width -= amount; }
    if (edge === 'e') f.width = Math.max(MIN, f.width + dx);
    if (edge === 'n') { const amount = Math.min(dy, f.height - MIN); f.y += amount; f.height -= amount; }
    if (edge === 's') f.height = Math.max(MIN, f.height + dy);
    return edit;
  }
  const local = rotate({ x: dx, y: dy }, -image.angle);
  const sx = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0;
  const sy = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
  let w = Math.max(MIN, image.width + sx * local.x), h = Math.max(MIN, image.height + sy * local.y);
  if (sx && sy && aspect && Number.isFinite(aspect) && aspect > 0) {
    h = Math.max(MIN, MIN / aspect, (w * aspect + h) / (aspect ** 2 + 1));
    w = h * aspect;
  }
  const center = rotate({ x: sx * (w - image.width) / 2, y: sy * (h - image.height) / 2 }, image.angle);
  image.x += center.x; image.y += center.y; image.width = w; image.height = h;
  return edit;
}
export function editorBounds(edit: ImageEdit, displayWidth = 640, aspect = 640 / 460): Rect {
  const i = edit.image, f = edit.frame;
  const points = [imagePoint(i, -i.width / 2, -i.height / 2), imagePoint(i, i.width / 2, -i.height / 2),
    imagePoint(i, i.width / 2, i.height / 2), imagePoint(i, -i.width / 2, i.height / 2),
    { x: f.x, y: f.y }, { x: f.x + f.width, y: f.y + f.height }];
  let unit = Math.max(i.width, i.height, f.width, f.height) / Math.max(180, displayWidth - 100);
  let bounds!: Rect;
  // Fit actual CSS-sized touch handles, including the rotation handle, on narrow/tall screens.
  for (let step = 0; step < 12; step++) {
    const all = [...points, imagePoint(i, 0, -i.height / 2 - 34 * unit)], padding = 30 * unit;
    const left = Math.min(...all.map(p => p.x)) - padding, right = Math.max(...all.map(p => p.x)) + padding;
    const top = Math.min(...all.map(p => p.y)) - padding, bottom = Math.max(...all.map(p => p.y)) + padding;
    const width = Math.max(right - left, (bottom - top) * aspect), height = width / aspect;
    bounds = { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
    unit = width / displayWidth;
  }
  return bounds;
}
export function outputSize(frame: Rect, longest: number) {
  const scale = Math.max(1, Math.round(longest)) / Math.max(frame.width, frame.height);
  return { width: Math.max(1, Math.round(frame.width * scale)), height: Math.max(1, Math.round(frame.height * scale)) };
}
/** The white frame is the exported area; image transforms never change the source bitmap. */
export function renderEdit(source: CanvasImageSource, edit: ImageEdit, longest: number): HTMLCanvasElement {
  const size = outputSize(edit.frame, longest), output = document.createElement('canvas');
  output.width = size.width; output.height = size.height;
  const ctx = output.getContext('2d');
  if (!ctx || output.width !== size.width || output.height !== size.height) throw new Error('해상도를 낮춰 다시 시도해 주세요.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height);
  ctx.scale(size.width / edit.frame.width, size.height / edit.frame.height);
  ctx.translate(-edit.frame.x, -edit.frame.y);
  const image = edit.image;
  ctx.translate(image.x, image.y); ctx.rotate(image.angle * Math.PI / 180);
  ctx.scale(image.flipX ? -1 : 1, image.flipY ? -1 : 1);
  ctx.drawImage(source, -image.width / 2, -image.height / 2, image.width, image.height);
  return output;
}
