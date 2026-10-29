import { Simulation } from './simulation';
import type { PatchResult } from './types';

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function surface(w: number, h: number): Surface {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// GPU Voronoi renderer: seed splat -> jump flooding -> source color lookup.
// Port of obamify's seed/jfa/shade WGSL passes to WebGL2 (MIT).
export class FluidRenderer {
  readonly canvas: Surface;
  private gl: WebGL2RenderingContext | null;
  private programs: WebGLProgram[] = [];
  private buffers: WebGLFramebuffer[] = [];
  private ids: WebGLTexture[] = [];
  private pos?: WebGLTexture;
  private colors?: WebGLTexture;
  private fallback?: Context;
  private initializedKey = '';
  private readonly size: number;

  constructor(size = 1024) {
    this.size = size;
    this.canvas = surface(this.size, this.size);
    this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: false }) as WebGL2RenderingContext | null;
    if (!this.gl) { this.canvas.width = this.size; this.fallback = this.canvas.getContext('2d') as Context; return; }
    const gl = this.gl;
    const quad = `#version 300 es
      precision highp float;
      void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); gl_Position=vec4(p*2.-1.,0.,1.); }`;
    const seed = `#version 300 es
      precision highp float; precision highp int;
      uniform sampler2D positions; uniform int cols; flat out int id;
      void main(){ id=gl_VertexID; vec2 p=texelFetch(positions,ivec2(id%cols,id/cols),0).rg; gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.); gl_PointSize=1.; }`;
    const seedFrag = `#version 300 es
      precision highp float; precision highp int; flat in int id; out vec4 color;
      void main(){color=vec4(float(id&255),float((id>>8)&255),float((id>>16)&255),float((id>>24)&255))/255.;}`;
    const jfa = `#version 300 es
      precision highp float; precision highp int;
      uniform sampler2D positions; uniform sampler2D ids; uniform int cols; uniform int jump; uniform vec2 resolution;
      out vec4 color;
      int decode(vec4 c){ivec4 v=ivec4(c*255.+.5);return v.r|(v.g<<8)|(v.b<<16)|(v.a<<24);}
      vec2 at(int i){return texelFetch(positions,ivec2(i%cols,i/cols),0).rg;}
      void main(){ivec2 here=ivec2(gl_FragCoord.xy);vec2 p=vec2(float(here.x)/resolution.x,(resolution.y-1.-float(here.y))/resolution.y);int best=decode(texelFetch(ids,here,0));float dist=3.4e38;
      if(best!=-1){vec2 d=p-at(best);dist=dot(d,d);}
      ivec2 offsets[8]=ivec2[8](ivec2(1,0),ivec2(-1,0),ivec2(0,-1),ivec2(0,1),ivec2(1,-1),ivec2(1,1),ivec2(-1,-1),ivec2(-1,1));
      for(int k=0;k<8;k++){ivec2 q=here+offsets[k]*jump;if(any(lessThan(q,ivec2(0)))||any(greaterThanEqual(q,ivec2(resolution))))continue;
      int i=decode(texelFetch(ids,q,0));if(i==-1)continue;vec2 d=p-at(i);float v=dot(d,d);if(v<dist){dist=v;best=i;}}
      color=vec4(float(best&255),float((best>>8)&255),float((best>>16)&255),float((best>>24)&255))/255.;}`;
    const shade = `#version 300 es
      precision highp float; precision highp int; uniform sampler2D ids; uniform sampler2D colors; uniform int cols; out vec4 color;
      void main(){ivec4 v=ivec4(texelFetch(ids,ivec2(gl_FragCoord.xy),0)*255.+.5);int id=v.r|(v.g<<8)|(v.b<<16)|(v.a<<24);color=id==-1?vec4(0.,0.,0.,1.):texelFetch(colors,ivec2(id%cols,id/cols),0);}`;
    try { this.programs = [this.program(seed, seedFrag), this.program(quad, jfa), this.program(quad, shade)]; }
    catch {
      this.dispose(); this.gl = null;
      this.canvas = surface(this.size, this.size);
      this.fallback = this.canvas.getContext('2d') as Context;
      return;
    }
    gl.disable(gl.BLEND); gl.disable(gl.DITHER);
    gl.bindVertexArray(gl.createVertexArray());
    this.pos = this.texture(); this.colors = this.texture();
    for (let i = 0; i < 2; i++) {
      const texture = this.texture(); this.ids.push(texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.size, this.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!; this.buffers.push(fb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private program(v: string, f: string) {
    const gl = this.gl!;
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log ?? 'shader'); }
      return s;
    };
    const p = gl.createProgram()!, vs = compile(gl.VERTEX_SHADER, v), fs = compile(gl.FRAGMENT_SHADER, f);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program');
    return p;
  }
  private texture() {
    const gl = this.gl!, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  render(patch: PatchResult, positions: Float32Array) {
    const gl = this.gl;
    if (!gl) {
      const c = this.fallback;
      if (c) {
        c.fillStyle = '#20271e'; c.fillRect(0, 0, this.size, this.size);
        for (let i = 0; i < patch.width * patch.height; i++) {
          const b = i * 4; c.fillStyle = `rgb(${patch.source[b]} ${patch.source[b + 1]} ${patch.source[b + 2]})`;
          c.fillRect(positions[i * 2] * this.size - this.size / patch.width / 2, positions[i * 2 + 1] * this.size - this.size / patch.height / 2, this.size / patch.width + 1, this.size / patch.height + 1);
        }
      }
      return this.canvas;
    }
    const key = `${patch.width}:${patch.height}`;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.pos!);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, patch.width, patch.height, 0, gl.RG, gl.FLOAT, positions);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.colors!);
    // A new patch may have the same dimensions and different pixels.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, patch.width, patch.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, patch.source);
    this.initializedKey = key;
    gl.viewport(0, 0, this.size, this.size);
    const seed = this.programs[0]; gl.useProgram(seed);
    gl.uniform1i(gl.getUniformLocation(seed, 'positions'), 0); gl.uniform1i(gl.getUniformLocation(seed, 'cols'), patch.width);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[0]); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, patch.width * patch.height);
    const jfa = this.programs[1]; gl.useProgram(jfa);
    gl.uniform1i(gl.getUniformLocation(jfa, 'positions'), 0); gl.uniform1i(gl.getUniformLocation(jfa, 'ids'), 1);
    gl.uniform1i(gl.getUniformLocation(jfa, 'cols'), patch.width); gl.uniform2f(gl.getUniformLocation(jfa, 'resolution'), this.size, this.size);
    let front = 0;
    for (let jump = 2 ** Math.ceil(Math.log2(this.size)) / 2; jump >= 1; jump >>= 1) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ids[front]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[1 - front]);
      gl.uniform1i(gl.getUniformLocation(jfa, 'jump'), jump); gl.drawArrays(gl.TRIANGLES, 0, 3); front = 1 - front;
    }
    const shade = this.programs[2]; gl.useProgram(shade); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ids[front]);
    gl.uniform1i(gl.getUniformLocation(shade, 'ids'), 1); gl.uniform1i(gl.getUniformLocation(shade, 'colors'), 2);
    gl.uniform1i(gl.getUniformLocation(shade, 'cols'), patch.width); gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.programs.forEach(p => gl.deleteProgram(p)); this.buffers.forEach(b => gl.deleteFramebuffer(b));
    [...this.ids, this.pos, this.colors].forEach(t => t && gl.deleteTexture(t));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function drawFinal(ctx: Context, base: CanvasImageSource, width: number, height: number, patches: PatchResult[]) {
  ctx.clearRect(0, 0, width, height); ctx.drawImage(base, 0, 0, width, height);
  const tile = surface(1, 1), tc = tile.getContext('2d') as Context;
  for (const patch of patches) {
    tile.width = patch.width; tile.height = patch.height;
    const rgba = new Uint8ClampedArray(patch.source.length);
    for (let i = 0; i < patch.assignment.length; i++) {
      const s = patch.assignment[i] * 4, d = i * 4;
      rgba[d] = patch.source[s]; rgba[d + 1] = patch.source[s + 1]; rgba[d + 2] = patch.source[s + 2]; rgba[d + 3] = 255;
    }
    tc.putImageData(new ImageData(rgba, patch.width, patch.height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, patch.rect.x, patch.rect.y, patch.rect.width, patch.rect.height);
    ctx.imageSmoothingEnabled = true;
  }
}

export function drawAnimation(ctx: Context, base: CanvasImageSource, width: number, height: number, patches: PatchResult[], sims: Simulation[], renderer: FluidRenderer, frame: number) {
  ctx.clearRect(0, 0, width, height); ctx.drawImage(base, 0, 0, width, height);
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i], positions = sims[i].advance(frame);
    const image = renderer.render(p, positions);
    ctx.drawImage(image, p.rect.x, p.rect.y, p.rect.width, p.rect.height);
  }
}
