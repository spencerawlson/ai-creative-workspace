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

def call(op, **options):
    """Run an exporter with the options this Blender's version has
    (they differ between releases: 5.0's FBX exporter has no
    use_selection, 5.3's does)."""
    try:
        known = set(op.get_rna_type().properties.keys())
    except (AttributeError, KeyError, RuntimeError):
        raise SystemExit(f"convert: this Blender has no {op.idname_py()} exporter")
    used = {k: v for k, v in options.items() if k in known}
    skipped = sorted(set(options) - set(used))
    if skipped:
        print(f"convert: this Blender's exporter has no {', '.join(skipped)}")
    return op(**used)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args["input"])
objs = list(bpy.context.scene.objects)

if fmt == "fbx":
    call(
        bpy.ops.export_scene.fbx,
        filepath=args["output"],
        use_selection=False,
        apply_scale_options="FBX_SCALE_ALL",
        bake_anim=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
    )
elif fmt == "usd":
    call(bpy.ops.wm.usd_export, filepath=args["output"], export_animation=True)
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
