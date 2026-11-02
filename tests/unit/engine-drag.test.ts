import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { dragOnSphere } from "@/lib/engine/StudioEngine";
import { LIGHT_PIVOT_Y, lightPosition } from "@/lib/lighting";

/** A ray from far away aimed exactly at a point on the light's sphere. */
function rayTo(
  p: [number, number, number],
  from = new THREE.Vector3(0, 1, 20),
) {
  const target = new THREE.Vector3(...p);
  return new THREE.Ray(from, target.clone().sub(from).normalize());
}

describe("dragOnSphere (light handle drag)", () => {
  it("recovers azimuth/elevation of the point under the pointer", () => {
    // Drags are continuous: the light starts near where the pointer is.
    // (Both sphere hits lie under the same pixel; the nearer one wins.)
    const light = { azimuth: 85, elevation: 20, distance: 4 };
    const target = { azimuth: 80, elevation: 20, distance: 4 };
    const r = dragOnSphere(rayTo(lightPosition(target)), light);
    expect(r).toEqual({ azimuth: 80, elevation: 20 });
  });

  it("keeps a light behind the subject behind it (nearest intersection)", () => {
    const rim = { azimuth: 180, elevation: 35, distance: 4 };
    const camera = new THREE.Vector3(0, 2, 10);
    const ray = new THREE.Ray(
      camera,
      new THREE.Vector3(0, LIGHT_PIVOT_Y, 0).sub(camera).normalize(),
    );
    const r = dragOnSphere(ray, rim)!;
    expect(r.azimuth).toBe(180);
  });

  it("clamps elevation to the schema range", () => {
    const light = { azimuth: 0, elevation: 30, distance: 2 };
    const ray = new THREE.Ray(
      new THREE.Vector3(0.01, 30, 0),
      new THREE.Vector3(0, -1, 0),
    );
    expect(dragOnSphere(ray, light)!.elevation).toBe(85);
  });

  it("handles a ray that misses the sphere", () => {
    const light = { azimuth: 90, elevation: 0, distance: 3 };
    const ray = new THREE.Ray(
      new THREE.Vector3(10, LIGHT_PIVOT_Y, 10),
      new THREE.Vector3(0, 0, -1),
    );
    expect(dragOnSphere(ray, light)).toEqual({ azimuth: 90, elevation: 0 });
  });
});
