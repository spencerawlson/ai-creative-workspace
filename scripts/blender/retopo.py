# Blender job: retopology. A sculpt (dense, uneven triangles) becomes a
# clean, even quad mesh at a chosen size, ready to rig and animate.
#
# Arguments (JSON):
#   input    a GLB with one mesh (no skin needed)
#   faces    target face count (quads), e.g. 8000
#   output   GLB to write (the quads are triangulated by glTF, in pairs)
#   report   JSON to write: method, faces, quads, vertices
#
# QuadriFlow first (even quads that follow the shape). It needs a closed,
# manifold surface, so the sculpt is first rebuilt by a voxel remesh fine
# enough to keep its detail. If QuadriFlow still fails, the voxel mesh
# is decimated to the target instead (triangles, not quads).

import json
import sys

import bpy

args = json.load(open(sys.argv[sys.argv.index("--") + 1]))
target = int(args.get("faces", 8000))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args["input"])
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("retopo: the file has no mesh")
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
# Apply the object's transform so sizes are real.
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

dims = obj.dimensions
size = max(dims.x, dims.y, dims.z)
before = len(obj.data.polygons)

# Closed and manifold first: voxels about 1/250 of the size keep fine
# detail (a finger, an ear) on a figure.
obj.data.remesh_voxel_size = size / 250
obj.data.use_remesh_fix_poles = True
bpy.ops.object.voxel_remesh()

method = "quadriflow"
try:
    res = bpy.ops.object.quadriflow_remesh(
        target_faces=target, use_preserve_sharp=False, use_mesh_symmetry=False, seed=0
    )
    ok = "FINISHED" in res and len(obj.data.polygons) > 0
except RuntimeError as e:
    print(f"retopo: quadriflow failed: {e}")
    ok = False
if not ok:
    method = "decimate"
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = min(1.0, target * 2 / max(1, len(obj.data.polygons)))
    bpy.ops.object.modifier_apply(modifier=mod.name)

# Smooth shading; clear any old custom normals.
bpy.ops.object.shade_smooth()

faces = len(obj.data.polygons)
quads = sum(1 for p in obj.data.polygons if len(p.vertices) == 4)
report = {
    "method": method,
    "before": before,
    "faces": faces,
    "quads": quads,
    "vertices": len(obj.data.vertices),
}
print("retopo:", json.dumps(report))
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=args["output"], export_format="GLB", use_selection=True, export_materials="EXPORT"
)
json.dump(report, open(args["report"], "w"))
