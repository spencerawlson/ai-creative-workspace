"use client";

import { useEffect, useRef } from "react";
import { kelvinToRgb, lightPosition, type LightState } from "@/lib/lighting";

/**
 * M2: real Three.js scene, Meshy mannequin, orbit + zoom, and THREE
 * controllable lights driven by React state from the page. Changing a
 * slider updates the live render; no light change requires a reload.
 */
export type MannequinModel = "male" | "female";

const MODEL_URL: Record<MannequinModel, string> = {
  male: "/meshy-body.glb",
  female: "/meshy-body-female.glb",
};

export function LightingScene({
  lights,
  view,
  viewNonce,
  model,
  fov,
  exposure,
}: {
  lights: LightState[];
  view: "face" | "full";
  viewNonce: number;
  model: MannequinModel;
  /** Optional Photography M1 camera override: vertical field of
   * view in degrees. Undefined keeps the Lighting Studio default 40. */
  fov?: number;
  /** Optional Photography M1 preview brightness multiplier.
   * Undefined keeps the Lighting Studio default 1.1. This is a
   * preview brightness aid, not a camera sensor simulation. */
  exposure?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lightsRef = useRef<LightState[]>(lights);
  lightsRef.current = lights;
  const viewRef = useRef<"face" | "full">(view);
  viewRef.current = view;
  const modelRef = useRef<MannequinModel>(model);
  modelRef.current = model;
  // Head height of the ACTIVE model, computed from its geometry on
  // load (average Y of vertices in the top 0.25 units of the scaled
  // figure) — never hard-coded to the male figure's head height, so
  // Face close-up lands on the female head too.
  const headHeightRef = useRef(1.72);
  const loadModelRef = useRef<((url: string) => void) | null>(null);
  const cameraRef = useRef<import("three").PerspectiveCamera | null>(null);
  const rendererRef = useRef<import("three").WebGLRenderer | null>(null);
  const fovRef = useRef<number | undefined>(fov);
  fovRef.current = fov;
  const exposureRef = useRef<number | undefined>(exposure);
  exposureRef.current = exposure;
  const controlsRef = useRef<{
    target: {
      x: number;
      y: number;
      z: number;
      set: (x: number, y: number, z: number) => void;
    };
    update: () => void;
    minDistance: number;
  } | null>(null);
  const pendingViewRef = useRef<"face" | "full" | null>(null);

  // View buttons (page.tsx): move the existing OrbitControls target +
  // camera without rebuilding the scene, so orbit/zoom keep working
  // afterwards and preset switches (lights only) never move the camera.
  useEffect(() => {
    if (viewNonce === 0) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      pendingViewRef.current = view;
      return;
    }
    // Allow close distances; the M1 minDistance of 1.4 would otherwise
    // clamp the face view back out.
    controls.minDistance = 0.3;
    if (view === "face") {
      // Keep the user's current orbit direction, just pull in close to
      // the head: face target at the ACTIVE model's computed head
      // height, camera 0.75 units out.
      const hh = headHeightRef.current;
      const t = controls.target as { x: number; y: number; z: number };
      const dx = camera.position.x - t.x;
      const dy = camera.position.y - t.y;
      const dz = camera.position.z - t.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      controls.target.set(0, hh, 0);
      camera.position.set(
        (dx / len) * 0.75,
        hh + (dy / len) * 0.75,
        (dz / len) * 0.75,
      );
    } else {
      controls.target.set(0, 0.95, 0);
      camera.position.set(0.6, 1.25, 3.4);
      cameraRef.current = camera;
    }
    controls.update();
  }, [view, viewNonce]);

  // Mannequin switch (page.tsx): swap the loaded GLB in place.
  // Lights, preset, and camera survive; the loader re-computes the
  // head height from the new model and re-aims Face close-up if set.
  useEffect(() => {
    const load = loadModelRef.current;
    if (load) load(MODEL_URL[model]);
  }, [model]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: import("three").WebGLRenderer | null = null;
    let animationId = 0;
    let disposed = false;
    const threeLights: Record<string, import("three").DirectionalLight> = {};

    async function init() {
      const THREE = await import("three");
      const { OrbitControls } =
        await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed || !container) return;
      const el = container;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111118);

      const camera = new THREE.PerspectiveCamera(
        40,
        container.clientWidth / container.clientHeight,
        0.1,
        100,
      );
      camera.position.set(0.6, 1.25, 3.4);
      cameraRef.current = camera;

      renderer = new THREE.WebGLRenderer({ antialias: true });
      rendererRef.current = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      container.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.95, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 1.4;
      controls.maxDistance = 6;
      controls.minPolarAngle = 0.15;
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
      controls.update();
      controlsRef.current = controls;
      // If a view button was pressed before the scene finished loading,
      // apply it now instead of dropping it.
      if (pendingViewRef.current) {
        const pending = pendingViewRef.current;
        pendingViewRef.current = null;
        controls.minDistance = 0.3;
        if (pending === "face") {
          const hh = headHeightRef.current;
          controls.target.set(0, hh, 0);
          camera.position.set(0.35, hh + 0.13, 0.65);
        }
        controls.update();
      }

      const skin = new THREE.MeshStandardMaterial({
        color: 0xd8d8de,
        roughness: 0.65,
        metalness: 0,
      });
      const figure = new THREE.Group();

      // ---- Figure: a Meshy model loaded as-is — no procedural body,
      // no grafted box head. Male and female are both Y-up, ~1.90
      // units tall, centred at the origin, facing +Z, each with its
      // own real face. Scale to ~1.88 units tall and stand it on
      // the ground plane (feet at y = 0). Switching models swaps
      // the figure in place; lights, camera, and controls survive.
      let loadToken = 0;
      const loadModel = async (url: string) => {
        const token = ++loadToken;
        const { GLTFLoader } =
          await import("three/examples/jsm/loaders/GLTFLoader.js");
        if (disposed || token !== loadToken) return;
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            if (disposed || token !== loadToken) return;
            // Remove the previous figure (if any) before adding the new one.
            while (figure.children.length > 0) {
              const old = figure.children[0];
              figure.remove(old);
              old.traverse((obj) => {
                const mesh = obj as import("three").Mesh;
                if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
              });
            }
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);
            const s = 1.88 / size.y;
            model.scale.setScalar(s);
            // After scaling, shift so feet sit at y = 0 and the
            // figure is centred on x/z.
            model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
            model.traverse((obj) => {
              const mesh = obj as import("three").Mesh;
              if (mesh.isMesh) {
                mesh.material = skin;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
              }
            });
            figure.add(model);
            // Head height from THIS model's geometry: average Y of
            // vertices in the top 0.25 units of the scaled figure
            // (head + neck band), clamped inside the figure.
            figure.updateMatrixWorld(true);
            const topY = size.y * s;
            let sum = 0;
            let count = 0;
            const v = new THREE.Vector3();
            model.traverse((obj) => {
              const mesh = obj as import("three").Mesh;
              if (!mesh.isMesh) return;
              const pos = mesh.geometry.attributes.position;
              if (!pos) return;
              for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
                if (v.y >= topY - 0.25) {
                  sum += v.y;
                  count += 1;
                }
              }
            });
            if (count > 0) {
              const hh = sum / count;
              headHeightRef.current = Math.min(
                Math.max(hh, topY - 0.3),
                topY - 0.05,
              );
            }
            // If the user is in Face close-up, re-aim at the new
            // model's head instead of leaving the old target.
            if (viewRef.current === "face") {
              const hh = headHeightRef.current;
              controls.target.set(0, hh, 0);
              camera.position.set(0.35, hh + 0.13, 0.65);
              controls.update();
            }
          },
          undefined,
          () => {
            // If the model fails to load, the canvas keeps the
            // previous figure (or stays blank on first load) rather
            // than showing a wrong figure.
          },
        );
      };
      loadModelRef.current = loadModel;
      loadModel(MODEL_URL[modelRef.current]);
      scene.add(figure);

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(6, 48),
        new THREE.ShadowMaterial({ opacity: 0.4 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Low ambient so Low-key stays dark and High-key is carried by fill.
      scene.add(new THREE.AmbientLight(0xffffff, 0.25));

      function applyLights() {
        for (const state of lightsRef.current) {
          let l = threeLights[state.id];
          if (!l) {
            l = new THREE.DirectionalLight(0xffffff, 1);
            l.castShadow = false;
            l.shadow.mapSize.set(1024, 1024);
            l.shadow.bias = -0.0005;
            l.shadow.camera.left = -2;
            l.shadow.camera.right = 2;
            l.shadow.camera.top = 3;
            l.shadow.camera.bottom = -1;
            l.target.position.set(0, 0.95, 0);
            scene.add(l.target);
            scene.add(l);
            threeLights[state.id] = l;
          }
          const [x, y, z] = lightPosition(state);
          l.position.set(x, y, z);
          const [r, g, b] = kelvinToRgb(state.temperature);
          l.color.setRGB(r, g, b);
          l.intensity = state.on ? state.intensity : 0;
          l.visible = state.on;
          l.castShadow = state.on && state.shadows;
          l.shadow.radius = state.softness;
        }
      }
      applyLights();
      // Re-apply on every frame: cheap, and guarantees slider changes
      // show up immediately even if React re-renders mid-gesture.
      const prevTick = () => {
        if (disposed) return;
        animationId = requestAnimationFrame(prevTick);
        // Photography M1 overrides, applied per frame so slider
        // changes show immediately. No override = defaults untouched.
        if (fovRef.current !== undefined && camera.fov !== fovRef.current) {
          camera.fov = fovRef.current;
          camera.updateProjectionMatrix();
        }
        if (exposureRef.current !== undefined && renderer) {
          renderer.toneMappingExposure = exposureRef.current;
        }
        applyLights();
        controls.update();
        if (renderer) renderer.render(scene, camera);
      };

      function onResize() {
        if (!renderer) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      window.addEventListener("resize", onResize);
      prevTick();

      (container as unknown as { __cleanup?: () => void }).__cleanup = () => {
        window.removeEventListener("resize", onResize);
        controls.dispose();
        if (renderer) {
          renderer.dispose();
          renderer.domElement.remove();
        }
      };
    }

    init().catch(() => {
      if (container) {
        container.textContent =
          "3D could not start in this browser (WebGL required).";
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationId);
      const cleanup = (container as unknown as { __cleanup?: () => void })
        .__cleanup;
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="lighting-scene"
      className="h-full w-full overflow-hidden rounded-xl bg-[#111118] [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:touch-none"
      role="img"
      aria-label="3D lighting studio with a mannequin. Drag to rotate, pinch to zoom."
    />
  );
}
