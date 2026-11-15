// xatlas.js ships no types; tests use its Node build (lib/sculpt/unwrap.ts
// describes the Api methods it calls).
declare module "xatlasjs/dist/node/api.mjs" {
  export const Api: (
    createModule: unknown,
  ) => new (
    onLoad?: () => void,
    locateFile?: (path: string, dir: string) => string,
    onProgress?: (mode: number, progress: number) => void,
  ) => import("@/lib/sculpt/unwrap").XAtlas;
}
declare module "xatlasjs/dist/node/xatlas.js" {
  const createModule: unknown;
  export default createModule;
}
