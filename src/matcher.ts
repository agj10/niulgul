import type { PatchInput, Settings } from './types';
import { assetUrl } from './images';

export class Matcher {
  private worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private reject?: (error: Error) => void;
  solve(patches: PatchInput[], settings: Settings, onProgress: (value: number) => void): Promise<{ assignments: Uint32Array[]; sources: Uint8ClampedArray[]; duration: number }> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.worker.onmessage = event => {
        const data = event.data;
        if (data.id !== id) return;
        if (data.type === 'progress') onProgress(data.progress);
        if (data.type === 'error') { this.reject = undefined; reject(new Error(data.message)); }
        if (data.type === 'done') { this.reject = undefined; resolve(data); }
      };
      this.worker.onerror = () => { this.reject = undefined; reject(new Error('변환 엔진을 실행하지 못했어요. 새로고침 후 다시 시도해주세요.')); };
      this.worker.postMessage({ id, patches, settings, engineUrl: assetUrl('engine/original.wasm') });
    });
  }
  dispose() {
    this.worker.terminate();
    this.reject?.(new Error('변환을 중지했어요.'));
    this.reject = undefined;
  }
}
