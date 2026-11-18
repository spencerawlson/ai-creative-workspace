# Zaka 3D: capability matrix

Every command in the spec's menus (`Zaka_Studio_3D_Design_Specification.md`
§4), classified against the app at `main` `e1f6ef5`. This is the source
of truth for which menu items are live and which are shown disabled
with their reason. Update it as each feature lands.

| Status          | Meaning                                                       |
| --------------- | ------------------------------------------------------------- |
| **WORKING**     | Present and covered by tests                                  |
| **PARTIAL**     | Some of it works (what's missing is noted)                    |
| **MISSING**     | Not built; buildable on the current stack                     |
| **BLOCKED**     | Needs another feature first (named)                           |
| **UNSUPPORTED** | Not possible in this architecture as it stands (reason given) |

"Scene graph" below means free objects with transforms, parents and
meshes in the Studio's scene document. It doesn't exist yet and most
of Create, Select, Modify and Mesh depend on it.

## File

| Command                                                       | Status      | Notes                                                                           |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| New: Scene                                                    | WORKING     | File > New scene (reset)                                                        |
| New: Project; From Template                                   | PARTIAL     | Lighting presets act as templates; no product/character/architectural templates |
| Open: Project (file)                                          | WORKING     | `.json` project files                                                           |
| Open: Recent Projects                                         | MISSING     |                                                                                 |
| Open: Recover Autosave                                        | PARTIAL     | Autosave restores on load; no explicit recover command                          |
| Save; Save As                                                 | PARTIAL     | Save project file (Ctrl+S) downloads JSON; no "Save As" to a path (browser)     |
| Incremental Save; Save Copy                                   | MISSING     |                                                                                 |
| Backup Preferences                                            | MISSING     |                                                                                 |
| Import: glTF/GLB                                              | PARTIAL     | As a character (.glb, .vrm); not as a scene object (needs scene graph)          |
| Import: STL; OBJ                                              | MISSING     | Parsers exist in three.js; need scene graph                                     |
| Import: FBX                                                   | MISSING     | three.js FBXLoader exists; need scene graph                                     |
| Import: USD; Alembic; SVG                                     | UNSUPPORTED | No maintained browser loader for USD/Alembic writes; SVG needs curves           |
| Export: Scene glTF/GLB                                        | WORKING     | With animation; validated                                                       |
| Export: STL                                                   | WORKING     | Statues (Studio), clay (Sculpt)                                                 |
| Export: images; video                                         | WORKING     | PNG/JPEG; MP4/WebM                                                              |
| Export: FBX; USD                                              | PARTIAL     | Server Blender job, only where that Blender can (not on the current server)     |
| Export: Selected Objects; OBJ; Bake Transform; Export Options | MISSING     | Selected needs scene graph                                                      |
| Export: Alembic                                               | UNSUPPORTED | No writer in the stack                                                          |
| Project: Settings (units, frame rate)                         | PARTIAL     | Units per device; frame rate fixed                                              |
| Project: External Assets; Pack; Relink; Validate              | MISSING     |                                                                                 |
| Exit: Close Project; Quit                                     | UNSUPPORTED | A web page: there is no app to quit                                             |

## Edit

| Command                                            | Status  | Notes                                                       |
| -------------------------------------------------- | ------- | ----------------------------------------------------------- |
| Undo; Redo                                         | WORKING | Ctrl+Z / Ctrl+Shift+Z, both workspaces                      |
| Undo History                                       | WORKING | History panel                                               |
| Repeat Last                                        | MISSING | Needs the command registry                                  |
| Duplicate; Delete                                  | PARTIAL | Lights and figures only                                     |
| Cut; Copy; Paste; Paste in Place; Duplicate Linked | MISSING | Needs scene graph                                           |
| Rename                                             | PARTIAL | Project and sculpture names; objects need scene graph       |
| Find Command                                       | MISSING | Needs the command registry                                  |
| Preferences; Keyboard Map; Restore Defaults        | PARTIAL | Shortcut list (read only); render quality, units per device |

## Create

| Command                                           | Status  | Notes                                                            |
| ------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| Mesh Primitives (Cube … Grid)                     | MISSING | Sculpt has start shapes (sphere, etc.); Studio needs scene graph |
| Curves & Text                                     | MISSING |                                                                  |
| Cameras: Perspective                              | PARTIAL | One scene camera; no extra or orthographic cameras               |
| Lights: Point; Spot; Area; Sun                    | WORKING | Up to 8                                                          |
| Lights: Environment / HDRI                        | MISSING | three.js supports it                                             |
| Rig Elements                                      | BLOCKED | Needs scene graph + armatures                                    |
| Scene Helpers: Measurement                        | WORKING | View > Measure a distance                                        |
| Scene Helpers: Empty; Reference Image; Collection | MISSING | Needs scene graph                                                |
| Procedural                                        | MISSING |                                                                  |
| Adjust Last Operation panel                       | MISSING | Needs the command registry                                       |

## Select

| Command                                             | Status  | Notes                     |
| --------------------------------------------------- | ------- | ------------------------- |
| Select by click (lights, figures, camera, backdrop) | WORKING |                           |
| Select All; None; Invert; Linked; Hierarchy         | PARTIAL | Deselect (Esc) only       |
| By Criteria; Selection Tools (box, lasso…)          | MISSING |                           |
| Component selection (vertex, edge, face)            | BLOCKED | Needs editable meshes     |
| Grow; Shrink; Soft; Selection Sets                  | BLOCKED | Needs component selection |

## Modify

| Command                                                  | Status  | Notes                                                      |
| -------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| Move; Rotate (figures, lights)                           | PARTIAL | Drag on the floor, sliders, numeric fields; no G/R/S gizmo |
| Scale; Universal Transform                               | MISSING |                                                            |
| Numeric Transform                                        | PARTIAL | Inspector fields for figures, lights, camera               |
| Snap                                                     | WORKING | Grid snapping, units                                       |
| Pivot; Apply/Freeze; Align; Distribute; Mirror (objects) | MISSING | Needs scene graph                                          |
| Relationships (Parent, Group, Link)                      | BLOCKED | Needs scene graph                                          |
| Modifiers                                                | BLOCKED | Needs editable meshes                                      |
| Utilities: Measure                                       | WORKING |                                                            |
| Utilities: Normalize Scale; Geometry Diagnostics         | MISSING |                                                            |

## Mesh

| Command                                                       | Status  | Notes                                                                                             |
| ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Face, Edge, Vertex tools; Topology; Boolean; Normals; Cleanup | BLOCKED | Need an editable polygon mesh with component selection (the clay is triangles, edited by brushes) |
| Topology: Remesh / Retopology                                 | PARTIAL | Server Blender job "clean quads"                                                                  |

## Curves

| Command | Status  | Notes |
| ------- | ------- | ----- |
| All     | MISSING |       |

## Sculpt

| Command                                                   | Status  | Notes                    |
| --------------------------------------------------------- | ------- | ------------------------ |
| Brushes: Draw; Clay; Smooth; Inflate; Grab; Flatten       | WORKING | Plus Pinch, Paint, Mask  |
| Brushes: Crease; Scrape                                   | MISSING | Pinch is close to Crease |
| Symmetry: X                                               | WORKING |                          |
| Symmetry: Y/Z; Radial                                     | MISSING |                          |
| Masks: Mask; Invert; Clear                                | WORKING |                          |
| Face Sets                                                 | MISSING |                          |
| Topology: Voxel Remesh; Dynamic Topology; Multiresolution | MISSING |                          |
| Brush settings: Radius; Strength; Pressure                | WORKING | Falloff, presets missing |

## Rig

| Command                                                        | Status  | Notes                                                        |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| Skinning: Auto Weights                                         | PARTIAL | Server auto-rig (opt-in) for imported models                 |
| Retarget: Map Skeleton; Retarget                               | PARTIAL | Poses and moves retarget to any humanoid (standard skeleton) |
| Skeleton; Bind; Weight Paint; IK chains; Constraints; Controls | BLOCKED | Need scene graph and armature objects                        |
| IK (posing)                                                    | PARTIAL | Drag-to-pose solves reach on figures                         |
| Mechanical Rig (hinge, slider, piston, end effector, limits)   | BLOCKED | Needs scene graph + joints with limits                       |
| Validate                                                       | MISSING |                                                              |

## Animate

| Command                                         | Status  | Notes                             |
| ----------------------------------------------- | ------- | --------------------------------- |
| Keyframes: Insert; Remove; Copy (move)          | WORKING | K, timeline, auto-key             |
| Editors: Timeline; Graph Editor                 | WORKING |                                   |
| Editors: Dope Sheet; NLA / Clip Editor          | MISSING | Beats are a simple clip sequencer |
| Interpolation: Linear; Bezier; Tangents; Easing | WORKING |                                   |
| Interpolation: Constant                         | MISSING |                                   |
| Playback: Play/Pause; Loop; Range (length)      | WORKING |                                   |
| Playback: FPS; Preview Range                    | MISSING | Fixed rate                        |
| Animation Layers                                | MISSING |                                   |
| Pose Library                                    | WORKING | Motion library + search           |
| Retarget Animation                              | PARTIAL | Humanoids                         |
| Export Animation                                | WORKING | GLB with animation; video         |
| Motion Paths; Bake to Keys                      | MISSING |                                   |

## Simulate

| Command                                                    | Status  | Notes                                                                                                                                                       |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All (rigid, soft, cloth, fluids, particles, forces, cache) | MISSING | Rigid bodies feasible with a browser physics library (e.g. Rapier, Apache-2.0); fluids and cloth at production quality are UNSUPPORTED in the browser today |

## Materials

| Command                                     | Status  | Notes                                                                     |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| Studio material presets and edits; finishes | PARTIAL | One material for the figures; no per-object materials (needs scene graph) |
| Base colour; roughness; metalness           | PARTIAL | Studio material fields                                                    |
| Shader node graph                           | MISSING |                                                                           |
| Textures; Texture Manager                   | MISSING |                                                                           |
| UV: Unwrap                                  | PARTIAL | Sculpt export unwraps automatically                                       |
| Paint and Bake                              | PARTIAL | Sculpt vertex paint, baked to texture on export                           |
| Validation                                  | MISSING |                                                                           |

## Render

| Command                                    | Status  | Notes                                                 |
| ------------------------------------------ | ------- | ----------------------------------------------------- |
| Render Image                               | WORKING | Export image (PNG/JPEG, sizes)                        |
| Render Animation                           | WORKING | MP4/WebM                                              |
| Engine: real-time raster; "High" post path | WORKING |                                                       |
| Engine: Path tracer                        | PARTIAL | Blender render job on the server; none in the browser |
| Camera: resolution; aspect; focal length   | WORKING |                                                       |
| Camera: depth of field                     | PARTIAL | "Lens look" on High                                   |
| Lighting: Exposure                         | WORKING |                                                       |
| Lighting: HDRI                             | MISSING |                                                       |
| Output: PNG                                | WORKING | EXR/TIFF MISSING                                      |
| Passes; Compositor; Queue                  | MISSING |                                                       |

## Assets

| Command                                     | Status  | Notes                                         |
| ------------------------------------------- | ------- | --------------------------------------------- |
| Asset browser (characters, creatures, cast) | PARTIAL | Character picker; not a general asset browser |
| Import Asset                                | PARTIAL | Characters only                               |
| Search, tags, versions, relink              | MISSING |                                               |

## AI

| Command                          | Status  | Notes                                                                                             |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| AI Assistant (directing a scene) | PARTIAL | MCP server for an external AI, opt-in, every change undoable through actions; no in-app assistant |
| Others                           | MISSING | Must stay opt-in with approval gates (spec §4.15)                                                 |

## Window

| Command                                                              | Status  | Notes                             |
| -------------------------------------------------------------------- | ------- | --------------------------------- |
| Workspaces: Sculpting; Animation (in Studio)                         | PARTIAL | Studio, Sculpt, Photography pages |
| Other workspaces                                                     | MISSING |                                   |
| Editors: 3D Viewport; Outliner (scene list); Inspector; Graph Editor | PARTIAL | Fixed layout                      |
| Split / Join / Detach area; Save Workspace; Reset Layout             | MISSING | Tear-off menus exist              |
| Show/Hide side panel                                                 | WORKING | `[`                               |
| UI Scale                                                             | MISSING |                                   |

## Help

| Command            | Status  | Notes |
| ------------------ | ------- | ----- |
| Keyboard Reference | WORKING | `?`   |
| About; Version     | MISSING |       |
| Others             | MISSING |       |
