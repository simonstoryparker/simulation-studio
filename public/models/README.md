# 3D Controller Models

To use the external 3D Xbox controller model:

1. Download the [White XBOX Controller by CREATRBOI](https://sketchfab.com/3d-models/white-xbox-controller-c46f717692b6497a9d6edee010a7bb67) on Sketchfab (free under CC BY 4.0).
2. Select **glTF** or **GLB** format.
3. Save the model here as `controller.glb` (or `controller.gltf`).

`Controller3D.tsx` will automatically detect the file, apply the dark silhouette + ink edge line-art shader style (`#1c1c1c` body, `#ababab` edges, `#674326` hover, `#895728` active), map button clicks to input capture, and fall back to the procedural model if the file is absent.
