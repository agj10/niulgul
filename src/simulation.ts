import { instantiateOriginalCore, type OriginalCore } from './original-core';
import type { PatchResult } from './types';

// This is a memory/clock adapter. All forces, RNG and f32 arithmetic run in
// vendor/obamify/src/app/morph_sim.rs without modifications.
export const SIMULATION_STEPS = 1440;
export const ANIMATION_SECONDS = SIMULATION_STEPS / 60;
export class Simulation {
  private rust: OriginalCore;
  readonly destinations: Float32Array;
  readonly initial: Float32Array;
  constructor(public patch: Pick<PatchResult, 'width' | 'height' | 'assignment'>) {
    if (patch.width !== patch.height) throw new Error('The original simulation uses a square grid.');
    this.rust = instantiateOriginalCore();
    const n = patch.width * patch.height;
    this.rust.sim_reserve(patch.width);
    new Uint32Array(this.rust.memory.buffer, this.rust.assignment_pointer(), n).set(patch.assignment);
    this.rust.sim_start();
    this.initial = this.positions.slice();
    this.destinations = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const src = patch.assignment[i];
      this.destinations[src * 2] = (i % patch.width + 0.5) / patch.width;
      this.destinations[src * 2 + 1] = (Math.floor(i / patch.width) + 0.5) / patch.height;
    }
  }
  get positions() { return new Float32Array(this.rust.memory.buffer, this.rust.positions_pointer(), this.patch.width * this.patch.height * 2); }
  advance(frame: number) { this.rust.sim_advance(Math.max(0, Math.floor(frame))); return this.positions; }
  get settled() { return this.rust.sim_error() < 0.05; }
  get error() { return this.rust.sim_error(); }
}
