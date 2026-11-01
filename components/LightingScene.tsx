"use client";

import { useEffect, useRef } from "react";

/**
 * M1 only: real Three.js scene, one procedural mannequin, one key light,
 * ambient light, orbit + zoom. No light controls or presets yet (M2).
 */
export function LightingScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: import("three").WebGLRenderer | null = null;
    let animationId = 0;
    let disposed = false;

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
      // Keep the camera above the floor.
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
      controls.update();

      // --- Mannequin: stylized, correct ~7.5-head proportions, 1.8 units tall.
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

      // Head, neck, torso, pelvis.
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

      // Arms (slightly away from the body) and legs.
      for (const side of [-1, 1]) {
        limb([side * 0.24, 1.44, 0], [side * 0.31, 1.12, 0], 0.055);
        limb([side * 0.31, 1.12, 0], [side * 0.33, 0.86, 0], 0.048);
        sphere(side * 0.33, 0.8, 0, 0.055);
        limb([side * 0.11, 0.92, 0], [side * 0.12, 0.5, 0], 0.085);
        limb([side * 0.12, 0.5, 0], [side * 0.12, 0.1, 0], 0.068);
        sphere(side * 0.12, 0.05, 0.05, 0.07, 1, 0.55, 1.7);
      }
      scene.add(figure);

      // Ground shadow catcher.
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(6, 48),
        new THREE.ShadowMaterial({ opacity: 0.4 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // M1 lights: one key light with a soft shadow + low ambient.
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(2.5, 3.5, 2.5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 4;
      key.shadow.bias = -0.0005;
      key.shadow.camera.left = -2;
      key.shadow.camera.right = 2;
      key.shadow.camera.top = 3;
      key.shadow.camera.bottom = -1;
      scene.add(key);
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));

      function onResize() {
        if (!renderer) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
      window.addEventListener("resize", onResize);

      function tick() {
        if (disposed) return;
        animationId = requestAnimationFrame(tick);
        controls.update();
        if (renderer) renderer.render(scene, camera);
      }
      tick();

      // Store cleanup on the container for the effect teardown below.
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
