export type FaceBox = { id: number; x: number; y: number; width: number; height: number };
export type Asset = {
  id: string;
  name: string;
  url: string;
  canvas: HTMLCanvasElement;
  faces: FaceBox[];
  detection: 'ready' | 'unavailable';
  targetCrop?: { x: number; y: number; width: number; height: number };
  builtinTarget?: boolean;
};
export type Settings = { strength: number; tone: number; cellSize: number };
export type PatchInput = {
  rect: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  source: Uint8ClampedArray;
  target: Uint8ClampedArray;
  rawSource?: { width: number; height: number; data: Uint8ClampedArray };
  rawTarget?: { width: number; height: number; data: Uint8ClampedArray };
  builtinTarget?: boolean;
};
export type PatchResult = PatchInput & { assignment: Uint32Array };
export type Result = {
  key: string;
  sourceId: string;
  targetId: string;
  base: HTMLCanvasElement;
  target: HTMLCanvasElement;
  patches: PatchResult[];
  duration: number;
  settings: Settings;
};
