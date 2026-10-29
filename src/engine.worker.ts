import type { PatchInput, Settings } from './types';
import { loadOriginalCore, instantiateOriginalCore, proximityForStrength, type OriginalCore } from './original-core';

let core: OriginalCore | undefined;
let report: (value: number) => void = () => {};
self.onmessage = async (event: MessageEvent<{ id: number; patches: PatchInput[]; settings: Settings; engineUrl: string }>) => {
  const { id, patches, settings, engineUrl } = event.data;
  try {
    await loadOriginalCore(engineUrl);
    core ??= instantiateOriginalCore(value => report(value));
    const rust = core;
    const started = performance.now(), assignments: Uint32Array[] = [], sources: Uint8ClampedArray[] = [];
    for (let index = 0; index < patches.length; index++) {
      const patch = patches[index];
      const source = patch.rawSource ?? { width: patch.width, height: patch.height, data: patch.source };
      const target = patch.rawTarget ?? { width: patch.width, height: patch.height, data: patch.target };
      rust.prepare(source.width, source.height, target.width, target.height);
      new Uint8Array(rust.memory.buffer, rust.input_source_pointer(), source.data.length).set(source.data);
      new Uint8Array(rust.memory.buffer, rust.input_target_pointer(), target.data.length).set(target.data);
      report = progress => self.postMessage({ type: 'progress', id, progress: (index + progress) / patches.length });
      // process_genetic and its FRand(12345) sequence are upstream Rust,
      // including on camera frames: no warm start or replacement optimizer.
      if (patch.width === patch.height) rust.solve(patch.width, proximityForStrength(settings.strength), settings.tone, patch.builtinTarget ? 1 : 0, settings.strength === 0 ? 1 : 0);
      else rust.solve_rect(patch.width, patch.height, proximityForStrength(settings.strength), settings.tone, patch.builtinTarget ? 1 : 0, settings.strength === 0 ? 1 : 0);
      assignments.push(new Uint32Array(rust.memory.buffer, rust.assignment_pointer(), patch.width * patch.height).slice());
      sources.push(new Uint8ClampedArray(rust.memory.buffer, rust.source_pointer(), patch.width * patch.height * 4).slice());
    }
    const transfers = [...assignments.map(value => value.buffer), ...sources.map(value => value.buffer)];
    self.postMessage({ type: 'done', id, assignments, sources, duration: performance.now() - started }, { transfer: transfers });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : '변환하지 못했어요. 다시 시도해 주세요.' });
  }
};
