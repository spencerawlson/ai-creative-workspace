# Blender job: automatic (bone heat) skin weights for a rigged GLB.
#
# Arguments (JSON):
#   input    a plain GLB (no meshopt) with one skinned mesh
#   bones    {name: [[head x, y, z], [tail x, y, z]]} in glTF space (+Y up)
#            for the bones that deform; the others don't
#   output   where to write {"names": [...], "vertices": [[x, y, z,
#            [[group, weight], ...]], ...]} (glTF space)
#
# Only weights come back; the caller keeps its own skeleton. Blender's
# importer may re-orient bones, so each bone's head and tail are set to
# the caller's segment before weighting.

import json
import sys

import bpy
from mathutils import Vector

args = json.load(open(sys.argv[sys.argv.index("--") + 1]))


def to_blender(p):
    # glTF (+Y up, +Z forward) -> Blender (+Z up, -Y forward).
    return Vector((p[0], -p[2], p[1]))


def to_gltf(v):
    return [v.x, v.z, -v.y]


bpy.ops.wm.read_factory_settings(use_empty=True)
# Keep the mesh where the file puts it: the importer can otherwise move
# it to a "guessed" bind pose.
try:
    bpy.ops.import_scene.gltf(filepath=args["input"], guess_original_bind_pose=False)
except TypeError:
    bpy.ops.import_scene.gltf(filepath=args["input"])
objects = list(bpy.context.scene.objects)
arm = next(o for o in objects if o.type == "ARMATURE")
mesh = next(o for o in objects if o.type == "MESH")

# Free the mesh from its old skin.
world = mesh.matrix_world.copy()
mesh.parent = None
mesh.matrix_world = world
for m in list(mesh.modifiers):
    if m.type == "ARMATURE":
        mesh.modifiers.remove(m)
mesh.vertex_groups.clear()

# Bones as the caller's segments; only those listed deform.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
inv = arm.matrix_world.inverted()
bones = args["bones"]
for eb in arm.data.edit_bones:
    eb.use_connect = False
for eb in arm.data.edit_bones:
    seg = bones.get(eb.name)
    if not seg:
        continue
    head = inv @ to_blender(seg[0])
    tail = inv @ to_blender(seg[1])
    if (tail - head).length < 1e-5:
        tail = head + Vector((0, 0, 1e-3))
    eb.head = head
    eb.tail = tail
bpy.ops.object.mode_set(mode="OBJECT")
for b in arm.data.bones:
    b.use_deform = b.name in bones

# Automatic weights.
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

names = [g.name for g in mesh.vertex_groups]
out = []
mw = mesh.matrix_world
for v in mesh.data.vertices:
    ws = sorted(((g.group, g.weight) for g in v.groups if g.weight > 0), key=lambda x: -x[1])[:4]
    p = to_gltf(mw @ v.co)
    out.append([round(p[0], 6), round(p[1], 6), round(p[2], 6), [[g, round(w, 5)] for g, w in ws]])
empty = sum(1 for v in out if not v[3])
print(f"auto_weights: {len(out)} vertices, {len(names)} groups, {empty} without weights")
json.dump({"names": names, "vertices": out}, open(args["output"], "w"))
