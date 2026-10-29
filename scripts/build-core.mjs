import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, 'test-results/rust');
const toolchain = resolve(local, 'rustup/toolchains/1.85.0-x86_64-pc-windows-gnu/bin');
const cargo = existsSync(resolve(toolchain, 'cargo.exe')) ? resolve(toolchain, 'cargo.exe') : 'cargo';
const env = { ...process.env };
if (cargo !== 'cargo') {
  env.RUSTUP_HOME = resolve(local, 'rustup');
  env.CARGO_HOME = resolve(local, 'cargo');
  env.RUSTC = resolve(toolchain, 'rustc.exe');
}
const result = spawnSync(cargo, ['build','--release','--locked','--target','wasm32-unknown-unknown','--manifest-path','core/Cargo.toml'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? 'Rust build failed. Install Rust and the wasm32-unknown-unknown target.');
  process.exit(1);
}
mkdirSync(resolve(root,'public/engine'),{recursive:true});
copyFileSync(resolve(root,'core/target/wasm32-unknown-unknown/release/niulgul_core.wasm'),resolve(root,'public/engine/original.wasm'));
const files = ['core/src/lib.rs','core/build.rs','core/Cargo.toml','core/Cargo.lock','vendor/obamify/src/app/calculate/mod.rs','vendor/obamify/src/app/morph_sim.rs','public/reference/target256.png','public/reference/weights256.png'];
const sources = Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')]));
writeFileSync(resolve(root,'public/engine/original.json'),JSON.stringify({implementation:'Spu7Nix/obamify process_genetic + morph_sim.rs',sources,wasmSha256:createHash('sha256').update(readFileSync(resolve(root,'public/engine/original.wasm'))).digest('hex')},null,2)+'\n');
console.log('Original Rust optimizer and simulation are ready.');

