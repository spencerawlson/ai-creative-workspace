/** Khronos's glTF validator (npm gltf-validator), the parts the tests use. */
declare module "gltf-validator" {
  export function validateBytes(bytes: Uint8Array): Promise<{
    issues: {
      numErrors: number;
      messages: Array<{ code: string; message: string; severity: number }>;
    };
  }>;
}
