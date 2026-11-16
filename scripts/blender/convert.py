# Blender job: convert a GLB to FBX or USD, keeping its skeleton, skin
# and animations (what game engines and film pipelines import).
#
# Arguments (JSON):
#   input    a GLB
#   format   "fbx" or "usd" (.usdc)
#   output   file to write
#   report   JSON to write: what was exported (meshes, armatures, actions)

import json
import sys

import bpy

args = json.load(open(sys.argv[sys.argv.index("--") + 1]))
fmt = args["format"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args["input"])
objs = list(bpy.context.scene.objects)

if fmt == "fbx":
    bpy.ops.export_scene.fbx(
        filepath=args["output"],
        use_selection=False,
        apply_scale_options="FBX_SCALE_ALL",
        bake_anim=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
    )
elif fmt == "usd":
    bpy.ops.wm.usd_export(filepath=args["output"], export_animation=True)
else:
    raise SystemExit(f"convert: unknown format {fmt}")

report = {
    "format": fmt,
    "meshes": sum(1 for o in objs if o.type == "MESH"),
    "armatures": sum(1 for o in objs if o.type == "ARMATURE"),
    "bones": sum(len(o.data.bones) for o in objs if o.type == "ARMATURE"),
    "actions": [a.name for a in bpy.data.actions],
}
print("convert:", json.dumps(report))
json.dump(report, open(args["report"], "w"))
