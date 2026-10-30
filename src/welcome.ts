import type { Settings } from './types';

export type WelcomeData = { side: number; source: Uint8ClampedArray; assignment: Uint32Array };
const MAGIC = 'NIULGUL1';

export function decodeWelcome(buffer: ArrayBuffer): WelcomeData {
  if (buffer.byteLength < 16) throw new Error('Incomplete welcome preset');
  const view = new DataView(buffer);
  if ([...MAGIC].some((letter, i) => view.getUint8(i) !== letter.charCodeAt(0))) throw new Error('Invalid welcome preset');
  const side = view.getUint32(8, true), count = side * side;
  if (!side || side > 2048 || view.getUint32(12, true) !== 0 || buffer.byteLength !== 16 + count * 8) throw new Error('Invalid welcome preset dimensions');
  const source = new Uint8ClampedArray(buffer.slice(16, 16 + count * 4));
  const assignment = new Uint32Array(count), seen = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const value = view.getUint32(16 + count * 4 + i * 4, true);
    if (value >= count || seen[value]) throw new Error('Invalid welcome preset assignment');
    seen[value] = 1; assignment[i] = value;
  }
  return { side, source, assignment };
}

export async function loadWelcome(url: string): Promise<WelcomeData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Welcome preset unavailable');
  return decodeWelcome(await response.arrayBuffer());
}

/** Consume the preset only for the initial, unchanged sample selection. */
export class WelcomeOnce {
  private available = true;
  constructor(private sourceId: string, private targetId: string, private data: WelcomeData) {}
  take(sourceId: string, targetId: string, scope: 'whole' | 'faces', settings: Settings) {
    if (!this.available) return;
    this.available = false;
    if (sourceId === this.sourceId && targetId === this.targetId && scope === 'whole'
      && settings.strength === 100 && settings.tone === 100 && settings.cellSize === 1) return this.data;
  }
}
