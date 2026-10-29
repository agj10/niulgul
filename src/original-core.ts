/** ABI only. Matching and motion run in the original Rust functions. */
export type OriginalCore = {
  memory: WebAssembly.Memory;
  prepare(sw: number, sh: number, tw: number, th: number): void;
  input_source_pointer(): number; input_target_pointer(): number;
  source_pointer(): number; assignment_pointer(): number;
  solve(side: number, proximity: number, tone: number, builtin: number, identity: number): void;
  sim_reserve(side: number): void; sim_start(): void; sim_advance(frame: number): void;
  positions_pointer(): number; sim_error(): number;
};
let module: WebAssembly.Module | undefined;
let loading: Promise<void> | undefined;
export function configureOriginalCore(bytes: BufferSource) { module = new WebAssembly.Module(bytes); }
export async function loadOriginalCore(url: string) {
  if (module) return;
  loading ??= (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('원본 변환 엔진을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
    module = await WebAssembly.compile(await response.arrayBuffer());
  })();
  try { await loading; } catch (error) { loading = undefined; throw error; }
}
export function instantiateOriginalCore(progress: (value: number) => void = () => {}) {
  if (!module) throw new Error('원본 변환 엔진이 아직 준비되지 않았어요.');
  return new WebAssembly.Instance(module, { env: { progress } }).exports as unknown as OriginalCore;
}
export const ORIGINAL_SETTINGS = { strength: 50, tone: 100, cellSize: 1 };
export function proximityForStrength(strength: number) {
  return strength >= 100 ? 0 : Math.max(1, Math.round(13 * 2 ** ((50 - strength) / 20)));
}
