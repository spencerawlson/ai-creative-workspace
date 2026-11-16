/** Baking a sculpture's look into textures for export: the clay drawn
 * flat in its UV layout (lib/sculpt/unwrap.ts) on the GPU, with the same
 * surface finish code as the screen (lib/engine/surface.ts) and the
 * paint over it, into a colour texture (sRGB) and a roughness/metalness
 * texture (glTF's: green roughness, blue metalness). Each chart's edge is
 * then grown outwards a few texels, so filtering at seams doesn't pull in
 * the empty background. */

import * as THREE from "three";
import { surfaceGlsl, type Finish } from "@/lib/engine/surface";
import type { SculptMesh } from "./mesh";
import type { Unwrapped } from "./unwrap";

export interface BakeLook {
  /** The material's colour, in linear light (THREE.Color's own). */
  color: THREE.Color;
  roughness: number;
  metalness: number;
  finish: Finish;
}

/** An RGBA image, top row first, matching glTF's UVs (v = 0 at top). */
export interface Baked {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The unwrapped clay with what the bake reads: UVs, rest positions
 * (for the finish) and paint, per new vertex. */
export function bakeGeometry(
  clay: SculptMesh,
  u: Unwrapped,
): THREE.BufferGeometry {
  const n = u.original.length;
  const pos = new Float32Array(n * 3);
  const paint = new Float32Array(n * 4);
  u.original.forEach((v, i) => {
    pos.set(clay.positions.subarray(v * 3, v * 3 + 3), i * 3);
    paint.set(clay.paint.subarray(v * 4, v * 4 + 4), i * 4);
  });
  const g = new THREE.BufferGeometry();
  // "position" carries the clay's own position: the vertex shader places
  // each vertex by its UV instead.
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(u.uvs, 2));
  g.setAttribute("paint", new THREE.BufferAttribute(paint, 4));
  g.setIndex(new THREE.BufferAttribute(u.index, 1));
  return g;
}

const VERTEX = `
attribute vec4 paint;
varying vec3 vIkoPos;
varying vec4 vPaint;
void main() {
  vIkoPos = position;
  vPaint = paint;
  gl_Position = vec4( uv * 2.0 - 1.0, 0.0, 1.0 );
}`;

function fragment(finish: Finish): string {
  const s = surfaceGlsl(finish);
  return `
uniform vec3 uBase;
uniform float uRough;
uniform float uMetal;
uniform int uPass;
varying vec4 vPaint;
${s ? s.pars : "varying vec3 vIkoPos;"}
float ikoToLinear( float c ) {
  return c <= 0.04045 ? c / 12.92 : pow( ( c + 0.055 ) / 1.055, 2.4 );
}
float ikoToSrgb( float c ) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow( c, 1.0 / 2.4 ) - 0.055;
}
void main() {
  vec4 diffuseColor = vec4( uBase, 1.0 );
  float roughnessFactor = uRough;
  float metalnessFactor = uMetal;
  ${s ? s.color : ""}
  vec3 paintColor = vec3( ikoToLinear( vPaint.r ), ikoToLinear( vPaint.g ), ikoToLinear( vPaint.b ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, paintColor, vPaint.a );
  ${s ? s.roughness : ""}
  ${s ? s.metalness : ""}
  if ( uPass == 0 ) {
    gl_FragColor = vec4( ikoToSrgb( diffuseColor.r ), ikoToSrgb( diffuseColor.g ), ikoToSrgb( diffuseColor.b ), 1.0 );
  } else {
    gl_FragColor = vec4( 1.0, clamp( roughnessFactor, 0.0, 1.0 ), clamp( metalnessFactor, 0.0, 1.0 ), 1.0 );
  }
}`;
}

/** Grow every filled texel's colour into empty neighbours, `steps` times
 * (alpha 0 marks empty). */
export function dilate(img: Baked, steps: number): void {
  const { width: w, height: h, data } = img;
  for (let s = 0; s < steps; s++) {
    const next = data.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (data[o + 3]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = (ny * w + nx) * 4;
          if (!data[q + 3]) continue;
          r += data[q];
          g += data[q + 1];
          b += data[q + 2];
          n++;
        }
        if (n) {
          next[o] = r / n;
          next[o + 1] = g / n;
          next[o + 2] = b / n;
          next[o + 3] = 255;
        }
      }
    data.set(next);
  }
}

/** Bake colour and roughness/metalness, `size` texels square. */
export function bakeTextures(
  renderer: THREE.WebGLRenderer,
  geometry: THREE.BufferGeometry,
  look: BakeLook,
  size: number,
): { color: Baked; orm: Baked } {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: fragment(look.finish),
    uniforms: {
      uBase: { value: look.color.clone() },
      uRough: { value: look.roughness },
      uMetal: { value: look.metalness },
      uPass: { value: 0 },
    },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera();
  const target = new THREE.WebGLRenderTarget(size, size, {
    depthBuffer: false,
  });
  const before = {
    target: renderer.getRenderTarget(),
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  const pass = (n: number): Baked => {
    material.uniforms.uPass.value = n;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    // Rows come bottom first, which is v = 0 first: glTF's top row.
    const img = {
      width: size,
      height: size,
      data: new Uint8ClampedArray(pixels.buffer),
    };
    dilate(img, 8);
    return img;
  };
  try {
    renderer.autoClear = false;
    return { color: pass(0), orm: pass(1) };
  } finally {
    renderer.setRenderTarget(before.target);
    renderer.setClearColor(before.clear, before.alpha);
    renderer.autoClear = before.autoClear;
    target.dispose();
    material.dispose();
  }
}
