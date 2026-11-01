"use client";

import { useEffect, useRef } from "react";
import {
  kelvinToRgb,
  lightPosition,
  type LightState,
} from "@/lib/lighting";

/**
 * M2: real Three.js scene, Meshy mannequin, orbit + zoom, and THREE
 * controllable lights driven by React state from the page. Changing a
 * slider updates the live render; no light change requires a reload.
 */
export function LightingScene({
  lights,
  view,
  viewNonce,
}: {
  lights: LightState[];
  view: "face" | "full";
  viewNonce: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lightsRef = useRef<LightState[]>(lights);
  lightsRef.current = lights;
  const cameraRef = useRef<import("three").PerspectiveCamera | null>(null);
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
      // the head: face target at head height, camera 0.75 units out.
      const t = controls.target as { x: number; y: number; z: number };
      const dx = camera.position.x - t.x;
      const dy = camera.position.y - t.y;
      const dz = camera.position.z - t.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      controls.target.set(0, 1.72, 0);
      camera.position.set(
        (dx / len) * 0.75,
        1.72 + (dy / len) * 0.75,
        (dz / len) * 0.75,
      );
    } else {
      controls.target.set(0, 0.95, 0);
      camera.position.set(0.6, 1.25, 3.4);
      cameraRef.current = camera;
    }
    controls.update();
  }, [view, viewNonce]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: import("three").WebGLRenderer | null = null;
    let animationId = 0;
    let disposed = false;
    let threeLights: Record<
      string,
      import("three").DirectionalLight
    > = {};

    async function init() {
      const THREE = await import("three");
      const { OrbitControls } = await import(
        "three/examples/jsm/controls/OrbitControls.js"
      );
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
          controls.target.set(0, 1.72, 0);
          camera.position.set(0.35, 1.85, 0.65);
        }
        controls.update();
      }

      const skin = new THREE.MeshStandardMaterial({
        color: 0xd8d8de,
        roughness: 0.65,
        metalness: 0,
      });
      const figure = new THREE.Group();

      // ---- Figure: a SINGLE Meshy model (from-scratch generation),
      // loaded as-is — no procedural body, no grafted box head.
      // The model is Y-up, 1.903 units tall, centred at the origin,
      // facing +Z, with its own real face (nose bridge, cheek
      // planes, brow ridge, jaw). Scale to ~1.88 units tall and
      // stand it on the ground plane (feet at y = 0).
      {
        const { GLTFLoader } = await import(
          "three/examples/jsm/loaders/GLTFLoader.js"
        );
        const loader = new GLTFLoader();
        loader.load(
          "/meshy-body.glb",
          (gltf) => {
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
          },
          undefined,
          () => {
            // If the model fails to load, the canvas stays blank
            // rather than showing a wrong figure — the GLB is the
            // figure now, there is no procedural fallback.
          },
        );
      }
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
