/** Surface finishes for the studio material and Sculpt's clay: marble
 * veins, stone grain, bronze patina. Worked out in the shader from each
 * vertex's rest position, so they need no UV maps (mannequins, plinths
 * and sculpted clay have none worth using) and stay put on the surface
 * when a figure is posed, moved or animated: a skinned mesh uses its
 * bind-pose position, everything else its own.
 *
 * Applied by patching three.js's standard material shader
 * (onBeforeCompile); each finish compiles its own program. */

export const FINISHES = ["plain", "marble", "stone", "patina"] as const;
export type Finish = (typeof FINISHES)[number];

export const FINISH_NAMES: Record<Finish, string> = {
  plain: "Plain",
  marble: "Marble",
  stone: "Stone",
  patina: "Patina",
};

interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

const VERTEX_PARS = `varying vec3 vIkoPos;`;
const VERTEX_MAIN = `
#ifdef USE_SKINNING
  vIkoPos = ( bindMatrix * vec4( position, 1.0 ) ).xyz;
#else
  vIkoPos = position;
#endif`;

/** Smooth 3D value noise and a few octaves of it (fbm), 0..1. */
const FRAGMENT_PARS = `
varying vec3 vIkoPos;
float ikoHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float ikoNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( ikoHash( i ), ikoHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( ikoHash( i + vec3( 0, 1, 0 ) ), ikoHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( ikoHash( i + vec3( 0, 0, 1 ) ), ikoHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( ikoHash( i + vec3( 0, 1, 1 ) ), ikoHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
float ikoFbm( vec3 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i++ ) {
    v += a * ikoNoise( p );
    p = p * 2.03 + vec3( 1.7, 9.2, 3.1 );
    a *= 0.5;
  }
  return v;
}`;

/** Each finish: changes to the base colour (before vertex colours and
 * paint), then to roughness and metalness. \`ikoAmount\` carries how much
 * of the finish a point has from one stage to the next. Positions are
 * in metres. */
const COLOR: Record<Exclude<Finish, "plain">, string> = {
  // Veins: soft grey wisps, fading at their edges and broken along
  // their length (not hard dark lines, which read as cracks), in a
  // faintly clouded stone.
  marble: `
  float ikoAmount = 0.0;
  {
    float n = ikoFbm( vIkoPos * 2.2 );
    float band = abs( sin( dot( vIkoPos, vec3( 1.2, 2.2, 0.7 ) ) * 4.0 + n * 7.0 ) );
    float fade = smoothstep( 0.18, 0.48, ikoFbm( vIkoPos * 3.0 + 5.0 ) );
    float vein = ( 1.0 - smoothstep( 0.0, 0.22, band ) ) * fade;
    float haze = ( 1.0 - smoothstep( 0.0, 0.7, band ) ) * fade;
    ikoAmount = vein;
    diffuseColor.rgb *= 0.95 + 0.07 * ikoFbm( vIkoPos * 7.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.61, 0.65 ), vein * 0.75 + haze * 0.12 );
  }`,
  // Mottled patches and a fine grain.
  stone: `
  float ikoAmount = 0.0;
  {
    float m = ikoFbm( vIkoPos * 2.5 );
    float g = ikoNoise( vIkoPos * 120.0 );
    ikoAmount = g;
    diffuseColor.rgb *= ( 0.80 + 0.34 * m ) * ( 0.88 + 0.24 * g );
  }`,
  // Green-blue verdigris in patches; there the metal turns matte.
  patina: `
  float ikoAmount = 0.0;
  {
    // Smaller patches all over, uneven within; a deep verdigris (in
    // linear light: it reads as a muted blue-green on screen).
    float p = ikoFbm( vIkoPos * 7.0 + 2.0 );
    ikoAmount = smoothstep( 0.47, 0.66, p ) * ( 0.55 + 0.45 * ikoNoise( vIkoPos * 45.0 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.14, 0.11 ), ikoAmount );
  }`,
};

const ROUGHNESS: Record<Exclude<Finish, "plain">, string> = {
  marble: `roughnessFactor = clamp( roughnessFactor + ikoAmount * 0.25, 0.0, 1.0 );`,
  stone: `roughnessFactor = clamp( roughnessFactor + 0.08 * ikoAmount, 0.0, 1.0 );`,
  patina: `roughnessFactor = mix( roughnessFactor, 0.85, ikoAmount );`,
};

const METALNESS: Record<Exclude<Finish, "plain">, string> = {
  marble: ``,
  stone: ``,
  patina: `metalnessFactor *= 1.0 - 0.85 * ikoAmount;`,
};

/** A finish's GLSL, for shaders other than the standard material's
 * (baking textures for export): the declarations (with the varying
 * `vIkoPos`, the rest position), then code that changes `diffuseColor`,
 * `roughnessFactor` and `metalnessFactor`, in that order. Null: plain. */
export function surfaceGlsl(finish: Finish) {
  if (finish === "plain") return null;
  return {
    pars: FRAGMENT_PARS,
    color: COLOR[finish],
    roughness: ROUGHNESS[finish],
    metalness: METALNESS[finish],
  };
}

function replace(src: string, find: string, by: string): string {
  if (!src.includes(find))
    throw new Error(`Surface finish: the shader has no ${find}`);
  return src.replace(find, by);
}

/** Add `finish` to a standard material's shader (in onBeforeCompile).
 * The base colour changes before `#include <color_fragment>`, so vertex
 * colours or paint applied there go on top. "plain" leaves it as is. */
export function patchSurface(shader: ShaderSource, finish: Finish): void {
  if (finish === "plain") return;
  shader.vertexShader = replace(
    replace(
      shader.vertexShader,
      "#include <common>",
      `#include <common>\n${VERTEX_PARS}`,
    ),
    "#include <begin_vertex>",
    `#include <begin_vertex>\n${VERTEX_MAIN}`,
  );
  let f = replace(
    shader.fragmentShader,
    "#include <common>",
    `#include <common>\n${FRAGMENT_PARS}`,
  );
  f = replace(
    f,
    "#include <color_fragment>",
    `${COLOR[finish]}\n#include <color_fragment>`,
  );
  f = replace(
    f,
    "#include <roughnessmap_fragment>",
    `#include <roughnessmap_fragment>\n${ROUGHNESS[finish]}`,
  );
  f = replace(
    f,
    "#include <metalnessmap_fragment>",
    `#include <metalnessmap_fragment>\n${METALNESS[finish]}`,
  );
  shader.fragmentShader = f;
}
