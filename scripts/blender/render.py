# Blender job: render a GLB, a still or a turntable / its animation as
# an MP4, with a studio setup (three-point lights, a floor that catches
# shadows, a grey backdrop).
#
# Arguments (JSON):
#   input       a GLB
#   output      PNG (still) or MP4 (video)
#   engine      "eevee" (fast) or "cycles" (path traced)
#   width, height
#   samples     render samples (cycles: 64 is a fair preview)
#   video       null for a still; else {"seconds": n, "fps": f,
#               "turntable": true|false} (turntable spins the camera;
#               false plays the file's first animation)
#   report      JSON to write: engine, size, frames, seconds taken
#
# Blender writes the MP4 itself (its own FFmpeg), so nothing else is
# needed on the machine.

import json
import math
import sys
import time

import bpy
from mathutils import Vector

args = json.load(open(sys.argv[sys.argv.index("--") + 1]))
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args["input"])
scene = bpy.context.scene
objs = [o for o in scene.objects if o.type == "MESH"]

# Bounds of everything imported, in world space.
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
centre = (lo + hi) / 2
size = max((hi - lo).x, (hi - lo).y, (hi - lo).z)

# Floor (shadow catcher) and backdrop colour.
bpy.ops.mesh.primitive_plane_add(size=size * 20, location=(centre.x, centre.y, lo.z))
floor = bpy.context.active_object
# A mid-grey floor (EEVEE has no shadow catcher; Cycles uses one).
floor_mat = bpy.data.materials.new("Floor")
floor_mat.use_nodes = True
floor_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.18, 0.2, 1)
floor_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
floor.data.materials.append(floor_mat)
world = bpy.data.worlds.new("Studio")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.085, 0.1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.4
scene.world = world

# Three-point lights around the subject.
def light(name, kind, energy, az, el, dist):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if kind == "AREA":
        data.size = size * 0.8
    ob = bpy.data.objects.new(name, data)
    a, e = math.radians(az), math.radians(el)
    ob.location = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    ob.rotation_euler = (centre - ob.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)

d = size * 2.5
light("Key", "AREA", 120 * size * size, 45, 35, d)
light("Fill", "AREA", 35 * size * size, -50, 20, d)
light("Rim", "AREA", 100 * size * size, 180, 40, d)

# Camera: 50 mm, framing the whole subject from the front, slightly high.
cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 50
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dist = size * 2.6
pivot = bpy.data.objects.new("Pivot", None)
pivot.location = centre
scene.collection.objects.link(pivot)
cam.parent = pivot
cam.location = Vector((0, -dist, size * 0.25))
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()

# Engine and output.
engine = args.get("engine", "eevee")
if engine == "cycles":
    scene.render.engine = "CYCLES"
    scene.cycles.samples = int(args.get("samples", 64))
    scene.cycles.use_denoising = True
else:
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
scene.render.resolution_x = int(args.get("width", 1280))
scene.render.resolution_y = int(args.get("height", 720))
scene.render.film_transparent = False

video = args.get("video")
frames = 1
if video:
    fps = int(video.get("fps", 24))
    frames = max(1, int(round(float(video.get("seconds", 4)) * fps)))
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = frames
    if video.get("turntable", True):
        pivot.rotation_euler = (0, 0, 0)
        pivot.keyframe_insert("rotation_euler", frame=1)
        pivot.rotation_euler = (0, 0, math.radians(360))
        pivot.keyframe_insert("rotation_euler", frame=frames + 1)
        for fc in pivot.animation_data.action.fcurves if pivot.animation_data.action and hasattr(pivot.animation_data.action, "fcurves") else []:
            for k in fc.keyframe_points:
                k.interpolation = "LINEAR"
    # Blender 5 chooses video output by media type first.
    if hasattr(scene.render.image_settings, "media_type"):
        scene.render.image_settings.media_type = "VIDEO"
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.filepath = args["output"]
    bpy.ops.render.render(animation=True)
else:
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = args["output"]
    bpy.ops.render.render(write_still=True)

report = {
    "engine": scene.render.engine,
    "width": scene.render.resolution_x,
    "height": scene.render.resolution_y,
    "frames": frames,
    "seconds": round(time.time() - t0, 1),
}
print("render:", json.dumps(report))
json.dump(report, open(args["report"], "w"))
