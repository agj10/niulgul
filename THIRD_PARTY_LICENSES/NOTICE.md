# Third-party notices

- The Rust optimizer and simulation in `vendor/obamify/` are compiled directly into `public/engine/original.wasm`. The Voronoi rendering approach and sample images are also from [Spu7Nix/obamify](https://github.com/Spu7Nix/obamify), Copyright (c) 2025 Spu7Nix, MIT. See `obamify.txt`.
- `frand 0.10.1` and `image 0.25.6`, included in the Rust binary: licensed under Apache-2.0 or MIT/Apache-2.0. See `Apache-2.0.txt` and `core/Cargo.lock`.
- `public/models/face-detector.tflite`: Google MediaPipe BlazeFace short-range face detector. Model family: [MediaPipe Face Detector](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector). Apache License 2.0; see `Apache-2.0.txt`.
- The generated `public/vision/` assets are copied from the installed `@mediapipe/tasks-vision` npm package by `scripts/prepare-assets.mjs`. Apache License 2.0. These generated files are not tracked in Git.
- `gifenc`: Copyright (c) 2017 Matt DesLauriers, MIT. See `gifenc.txt`.
- Lucide React: ISC / Feather MIT. See `lucide.txt`.

Other npm dependency licenses remain available in their installed packages and upstream repositories.
