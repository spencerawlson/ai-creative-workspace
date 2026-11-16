# Blender job: what this Blender can actually do. Distribution builds
# differ from the official ones (Ubuntu's 5.0 has no USD and a broken FBX
# exporter; its glTF importer needs numpy, which may be missing), so each
# ability is tried for real on a tiny scene, not guessed from the
# version.
#
# Arguments (JSON):
#   report   JSON to write: {"version", "gltf", "fbx", "usd", "render"}

import json
import os
import sys
import tempfile

import bpy

args = json.load(open(sys.argv[sys.argv.index("--") + 1]))
tmp = tempfile.mkdtemp(prefix="iko-probe-")
found = {"version": bpy.app.version_string}


def attempt(name, fn):
    try:
        fn()
        found[name] = True
    except Exception as e:  # noqa: BLE001 - any failure means "can't"
        found[name] = False
        print(f"probe: {name}: {type(e).__name__}: {e}")


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
glb = os.path.join(tmp, "cube.glb")


def gltf():
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    assert any(o.type == "MESH" for o in bpy.context.scene.objects)


def fbx():
    path = os.path.join(tmp, "cube.fbx")
    bpy.ops.export_scene.fbx(filepath=path)
    assert os.path.getsize(path) > 0


def usd():
    path = os.path.join(tmp, "cube.usdc")
    bpy.ops.wm.usd_export(filepath=path)
    assert os.path.getsize(path) > 0


def render():
    scene = bpy.context.scene
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.location = (4, -4, 3)
    cam.rotation_euler = (1.1, 0, 0.8)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 32
    scene.render.resolution_y = 32
    scene.render.filepath = os.path.join(tmp, "frame.png")
    bpy.ops.render.render(write_still=True)
    assert os.path.getsize(scene.render.filepath) > 0


attempt("gltf", gltf)
attempt("fbx", fbx)
attempt("usd", usd)
attempt("render", render)
print("probe:", json.dumps(found))
json.dump(found, open(args["report"], "w"))
