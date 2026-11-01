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
      // Joint material: slightly darker than the skin, so the
      // articulated joints read as discs/gaps, as on the reference.
      const jointMat = new THREE.MeshStandardMaterial({
        color: 0x9c9ca4,
        roughness: 0.7,
        metalness: 0,
      });

      function sphere(
        x: number,
        y: number,
        z: number,
        r: number,
        sx = 1,
        sy = 1,
        sz = 1,
        mat = skin,
      ) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat);
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
          new THREE.CapsuleGeometry(radius, length, 6, 14),
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

      // Tapered segment (e.g. thigh, calf, forearm): cylinder with a
      // different radius at each end, oriented from -> to.
      function tapered(
        from: [number, number, number],
        to: [number, number, number],
        rTop: number,
        rBottom: number,
      ) {
        const a = new THREE.Vector3(...from);
        const b = new THREE.Vector3(...to);
        const dir = new THREE.Vector3().subVectors(b, a);
        const length = dir.length();
        // CylinderGeometry is +Y up with radiusTop at +Y, but the
        // quaternion below maps +Y onto (to - from), which points
        // down for our top-to-bottom segments — so the radii are
        // swapped here to keep rTop at the `from` end.
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(rBottom, rTop, length, 18),
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

      // Flat joint disc, axis along Y unless rotated by the caller.
      function jointDisc(
        x: number,
        y: number,
        z: number,
        r: number,
        tiltX = 0,
        tiltZ = 0,
      ) {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, 0.022, 18),
          jointMat,
        );
        mesh.position.set(x, y, z);
        mesh.rotation.x = tiltX;
        mesh.rotation.z = tiltZ;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        figure.add(mesh);
        return mesh;
      }

      // ---- Proportions: total ~1.84 units, head ~0.24, so ~7.5 heads.
      // ---- Head: ovoid, slightly elongated, with a face plane.
      // Cranium + a smaller, forward jaw sphere gives the face a
      // flattened front plane instead of one round ball.
      sphere(0, 1.76, 0, 0.115, 0.92, 1.12, 0.98);
      // Jaw / lower face, slightly forward.
      sphere(0, 1.675, 0.022, 0.088, 0.88, 0.95, 0.9);
      // Nose ridge: a small vertical capsule protruding forward.
      // This is what throws the Butterfly nose shadow and breaks
      // up the Rembrandt cheek shading.
      {
        const nose = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.011, 0.05, 4, 10),
          skin,
        );
        nose.position.set(0, 1.72, 0.108);
        nose.rotation.x = 0.25;
        nose.castShadow = true;
        nose.receiveShadow = true;
        figure.add(nose);
      }
      // Brow ridge: a shallow flattened bar across the forehead.
      sphere(0, 1.765, 0.088, 0.05, 1.35, 0.32, 0.45);
      // Neck: distinct cylinder, not merged into the torso.
      tapered([0, 1.66, 0], [0, 1.57, 0], 0.048, 0.055);

      // ---- Torso: chest plate wider at the shoulders, tapering
      // to the waist, then a separate abdomen with a waist break.
      {
        const chest = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.148, 0.06, 6, 20),
          skin,
        );
        chest.position.set(0, 1.43, 0);
        chest.scale.set(1.18, 1, 0.72);
        chest.castShadow = true;
        chest.receiveShadow = true;
        figure.add(chest);
      }
      // No separate pectoral lumps: additive spheres against the chest
      // shell read as two balls (intersection seam). The reference
      // chest is a single smooth plate, so the chest capsule alone
      // carries it, with the waist/abdomen breaks below for detail.
      // Abdomen: three short stacked segments with small gaps,
      // giving 3-4 shallow horizontal breaks.
      tapered([0, 1.25, 0], [0, 1.20, 0], 0.098, 0.094);
      tapered([0, 1.19, 0], [0, 1.14, 0], 0.094, 0.09);
      // Dark discs at the segment breaks, so the abdomen reads
      // as segmented instead of one smooth bulge.
      jointDisc(0, 1.195, 0, 0.092);
      jointDisc(0, 1.135, 0, 0.09);

      // ---- Pelvis: brief-like form, distinct from the thighs.
      sphere(0, 1.05, 0, 0.12, 1.05, 0.9, 0.8);
      sphere(0, 1.02, 0.05, 0.09, 1.0, 0.8, 0.55);

      // ---- Arms (neutral, at the sides, hands reaching mid-thigh).
      for (const side of [-1, 1]) {
        const sx = side;
        // Shoulder ball + joint disc.
        sphere(sx * 0.195, 1.50, 0, 0.062);
        jointDisc(sx * 0.205, 1.46, 0, 0.055, 0, sx * 0.35);
        // Upper arm, tapering to the elbow.
        tapered([sx * 0.215, 1.45, 0], [sx * 0.245, 1.16, 0], 0.052, 0.042);
        // Elbow joint.
        sphere(sx * 0.25, 1.14, 0, 0.045);
        jointDisc(sx * 0.25, 1.14, 0, 0.042, 0, sx * 0.15);
        // Forearm, tapering to the wrist.
        tapered([sx * 0.25, 1.12, 0], [sx * 0.26, 0.88, 0], 0.042, 0.033);
        // Wrist joint.
        jointDisc(sx * 0.262, 0.87, 0, 0.034, 0, sx * 0.1);
        // Hand: flattened rounded form + a thumb suggestion.
        sphere(sx * 0.262, 0.80, 0.01, 0.045, 0.75, 1.25, 0.5);
        limb(
          [sx * 0.285, 0.84, 0.01],
          [sx * 0.29, 0.76, 0.03],
          0.014,
        );
      }

      // ---- Legs: thigh tapering to the knee, calf to the ankle,
      // feet slightly apart, forward-facing feet with a forefoot.
      for (const side of [-1, 1]) {
        const sx = side;
        const hipX = sx * 0.105;
        const footX = sx * 0.13;
        // Hip joint disc.
        jointDisc(hipX, 0.99, 0, 0.075);
        // Thigh.
        tapered([hipX, 0.98, 0], [footX, 0.54, 0], 0.078, 0.058);
        // Knee joint.
        sphere(footX, 0.51, 0.01, 0.055, 1, 0.9, 0.95);
        jointDisc(footX, 0.50, 0, 0.052);
        // Calf.
        tapered([footX, 0.48, 0], [footX, 0.12, 0], 0.055, 0.036);
        // Ankle joint.
        jointDisc(footX, 0.11, 0, 0.036);
        // Foot: elongated, slightly flattened, toe end forward.
        sphere(footX, 0.055, 0.075, 0.05, 0.85, 0.55, 1.9);
        sphere(footX, 0.045, 0.155, 0.035, 0.9, 0.5, 1.0);
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
