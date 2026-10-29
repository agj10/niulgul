import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { FluidRenderer, drawAnimation, drawFinal } from './render';
import { Simulation } from './simulation';
import { loadOriginalCore } from './original-core';
import type { PatchResult } from './types';

self.onmessage = async (event: MessageEvent<{ base: ImageBitmap; patches: PatchResult[]; width: number; height: number; engineUrl: string }>) => {
  const { base, patches, width, height } = event.data;
  let renderer: FluidRenderer | undefined;
  try {
    await loadOriginalCore(event.data.engineUrl);
    const scale = 1;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const out = new OffscreenCanvas(w, h), ctx = out.getContext('2d', { willReadFrequently: true })!;
    const scaled = patches.map(p => ({ ...p, rect: { x: p.rect.x * scale, y: p.rect.y * scale, width: p.rect.width * scale, height: p.rect.height * scale } }));
    ctx.drawImage(base, 0, 0, w, h);
    const palette = quantize(ctx.getImageData(0, 0, w, h).data, 256);
    const gif = GIFEncoder();
    let first = true;
    const write = (delay: number) => {
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, w, h, { palette: first ? palette : undefined, delay, repeat: 0, dispose: 1 });
      first = false;
    };
    // Deliberate holds, not blank frames and not a recording of the UI.
    write(1000);
    renderer = new FluidRenderer(Math.max(1024, width, height));
    const sims = scaled.map(p => new Simulation(p));
    // Original gif_recorder.rs: 8fps, 7 simulation updates per frame,
    // speed 1.5, minimum 100 / maximum 140 frames. No forced settling.
    for (let i = 0; i < 140; i++) {
      drawAnimation(ctx, base, w, h, scaled, sims, renderer, i * 7);
      write(80);
      if (i % 3 === 0) self.postMessage({ type: 'progress', progress: (i + 1) / 140 });
      if (i >= 99 && sims.every(sim => sim.settled)) break;
    }
    // Hold the actual final upstream simulation frame, without snapping.
    write(1000); gif.finish();
    const bytes = gif.bytes().slice();
    self.postMessage({ type: 'done', bytes }, { transfer: [bytes.buffer] });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'GIF를 만들지 못했어요.' });
  } finally { renderer?.dispose(); base.close(); }
};
