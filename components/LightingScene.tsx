"use client";

import { useEffect, useRef } from "react";
import {
  kelvinToRgb,
  lightPosition,
  type LightState,
} from "@/lib/lighting";

/**
 * M2: real Three.js scene, procedural mannequin, orbit + zoom, and THREE
 * controllable lights driven by React state from the page. Changing a
 * slider updates the live render; no light change requires a reload.
 */
export function LightingScene({ lights }: { lights: LightState[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lightsRef = useRef<LightState[]>(lights);
  lightsRef.current = lights;

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

      const skin = new THREE.MeshStandardMaterial({
        color: 0xd8d8de,
        roughness: 0.65,
        metalness: 0,
      });
      const figure = new THREE.Group();

      function sphere(
        x: number,
        y: number,
        z: number,
        r: number,
        sx = 1,
        sy = 1,
        sz = 1,
      ) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), skin);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        figure.add(mesh);
        return mesh;
      }

      function limb(
        from: [number, number, number],
        to: [number, number, number],
        radius: number,
      ) {
        const a = new THREE.Vector3(...from);
        const b = new THREE.Vector3(...to);
        const dir = new THREE.Vector3().subVectors(b, a);
        const length = dir.length();
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(radius, length, 8, 16),
          skin,
        );
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        figure.add(mesh);
        return mesh;
      }

      sphere(0, 1.68, 0, 0.115);
      limb([0, 1.62, 0], [0, 1.5, 0], 0.05);
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.16, 0.42, 8, 24),
        skin,
      );
      torso.position.set(0, 1.24, 0);
      torso.scale.set(1.3, 1, 0.72);
      torso.castShadow = true;
      torso.receiveShadow = true;
      figure.add(torso);
      sphere(0, 0.96, 0, 0.14, 1.25, 0.8, 0.85);
      for (const side of [-1, 1]) {
        limb([side * 0.24, 1.44, 0], [side * 0.31, 1.12, 0], 0.055);
        limb([side * 0.31, 1.12, 0], [side * 0.33, 0.86, 0], 0.048);
        sphere(side * 0.33, 0.8, 0, 0.055);
        limb([side * 0.11, 0.92, 0], [side * 0.12, 0.5, 0], 0.085);
        limb([side * 0.12, 0.5, 0], [side * 0.12, 0.1, 0], 0.068);
        sphere(side * 0.12, 0.05, 0.05, 0.07, 1, 0.55, 1.7);
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
