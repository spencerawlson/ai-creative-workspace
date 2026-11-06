/** The "High" render path: the scene through post-processing, then the
 * editing overlays (light handles, joint dots, bone lines) drawn on top,
 * untouched by the effects.
 *
 *   scene ─ RenderPass (4× MSAA, half float, linear)
 *         ─ GTAO: ambient occlusion, so creases, armpits and the floor
 *           under the feet darken as they would in a real studio
 *         ─ Bokeh: depth of field from the lens's f-stop, focused on the
 *           subject
 *         ─ UnrealBloom: highlights glow
 *         ─ OutputPass: the renderer's tone mapping and exposure, to sRGB
 *         ─ Lens: vignette and film grain
 *
 * Each effect is skipped when it's off, so the cost is only what's used.
 * Overlays live on their own layer (OVERLAY_LAYER) and are drawn in a
 * second plain render after the composite. */

import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { untoneMap, type ToneCurve } from "./tonemap";

/** Objects drawn over the effects (handles, dots, lines). */
export const OVERLAY_LAYER = 1;

export interface PostSettings {
  /** Ambient occlusion (the device's High quality). */
  ao: boolean;
  /** Depth of field: f-stop, or null for everything sharp. */
  fStop: number | null;
  /** Focus distance, metres from the camera. */
  focus: number;
  /** Lens focal length in mm (longer lenses blur more at an f-stop). */
  focalMm: number;
  /** 0..1 each. */
  bloom: number;
  vignette: number;
  grain: number;
}

/** Whether the scene needs the post-processing path at all. */
export function needsPost(s: PostSettings): boolean {
  return (
    s.ao || s.fStop !== null || s.bloom > 0 || s.vignette > 0 || s.grain > 0
  );
}

/** Bokeh's aperture uniform for an f-stop: the circle of confusion grows
 * with the square of the focal length and shrinks with the f-number.
 * Tuned so f/1.4 at 85 mm melts the backdrop, f/16 is nearly sharp. */
export function bokehAperture(fStop: number, focalMm: number): number {
  return (0.0016 * (focalMm / 50) ** 2) / fStop;
}

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0 },
    grain: { value: 0 },
    seed: { value: 0 },
    aspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float grain;
    uniform float seed;
    uniform float aspect;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      // Darkens towards the corners; the middle stays as it was.
      float v = smoothstep(0.35, 1.05, length(d) / max(aspect, 1.0) * 1.6);
      c.rgb *= 1.0 - vignette * 0.75 * v;
      // Fine monochrome grain, stronger in the mid-tones like film.
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float n = hash(vUv * vec2(1733.0, 997.0)) - 0.5;
      c.rgb += grain * 0.12 * n * (1.0 - abs(l - 0.5) * 1.2);
      gl_FragColor = c;
    }`,
};

export class PostPipeline {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bokeh: BokehPass;
  private readonly bloom: UnrealBloomPass;
  private readonly lens: ShaderPass;
  private readonly bokehUniforms: Record<string, THREE.IUniform>;
  private frame = 0;
  /** The backdrop colour, pre-compensated for tone mapping (cached). */
  private backdrop = { key: "", color: new THREE.Color() };
  /** Writes depth only: the scene's surfaces, so overlays behind the
   * figure are hidden as on the plain path. */
  private readonly depthOnly = new THREE.MeshBasicMaterial({
    colorWrite: false,
  });

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    // A soft, studio-scale occlusion: half a head's reach, gentle.
    this.gtao.updateGtaoMaterial({
      radius: 0.35,
      distanceExponent: 1.5,
      thickness: 1,
      scale: 1,
      samples: 16,
    });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.bokeh = new BokehPass(scene, camera, {
      focus: 3,
      aperture: 0.0001,
      maxblur: 0.012,
    });
    this.bokehUniforms = (
      this.bokeh as unknown as { uniforms: Record<string, THREE.IUniform> }
    ).uniforms;
    this.composer.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(size.clone(), 0.5, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    this.composer.addPass(this.lens);
  }

  setSize(width: number, height: number, ratio: number): void {
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.lens.uniforms.aspect.value = width / Math.max(1, height);
  }

  configure(s: PostSettings): void {
    this.gtao.enabled = s.ao;
    this.bokeh.enabled = s.fStop !== null;
    if (s.fStop !== null) {
      this.bokehUniforms.focus.value = s.focus;
      this.bokehUniforms.aperture.value = bokehAperture(s.fStop, s.focalMm);
    }
    this.bloom.enabled = s.bloom > 0;
    this.bloom.strength = 0.9 * s.bloom;
    this.lens.enabled = s.vignette > 0 || s.grain > 0;
    this.lens.uniforms.vignette.value = s.vignette;
    this.lens.uniforms.grain.value = s.grain;
  }

  /** Draw the scene with its effects, then the overlays on top.
   * `curve` is the renderer's tone mapping; `overlayDepth`, whether
   * overlays that depth-test (light handles) are showing. */
  render(curve: ToneCurve, overlayDepth: boolean): void {
    const { renderer, scene, camera } = this;
    const layers = camera.layers.mask;
    const shadows = renderer.shadowMap.autoUpdate;
    const background = scene.background;
    // Shadow maps once a frame, not again for each effect's own render.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = shadows;
    this.lens.uniforms.seed.value = (this.frame++ % 64) * 0.731;
    // The plain render shows the backdrop colour untouched; here the
    // whole frame is tone-mapped, so clear to what maps back to it.
    if (background instanceof THREE.Color) {
      const exposure = renderer.toneMappingExposure;
      const key = `${background.getHexString()}:${curve}:${exposure}`;
      if (key !== this.backdrop.key) {
        const [r, g, b] = untoneMap(
          [background.r, background.g, background.b],
          curve,
          exposure,
        );
        this.backdrop = { key, color: new THREE.Color(r, g, b) };
      }
      scene.background = this.backdrop.color;
    }
    camera.layers.set(0);
    this.composer.render();
    scene.background = null;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    if (overlayDepth) {
      // The composite wrote no depth to the screen: lay the scene's down
      // (colour untouched) so a handle behind the figure stays hidden.
      scene.overrideMaterial = this.depthOnly;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
    }
    // The overlays, plain, over the finished image.
    camera.layers.set(OVERLAY_LAYER);
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
    scene.background = background;
    camera.layers.mask = layers;
    renderer.shadowMap.autoUpdate = shadows;
  }

  dispose(): void {
    this.gtao.dispose();
    this.bokeh.dispose();
    this.bloom.dispose();
    this.lens.dispose();
    this.depthOnly.dispose();
    this.composer.dispose();
  }
}
