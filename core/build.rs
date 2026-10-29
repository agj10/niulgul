use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let source_path = root.join("vendor/obamify/src/app/calculate/mod.rs");
    let text = fs::read_to_string(&source_path).unwrap().replace("\r\n", "\n");
    // Reuse upstream scoring, RNG and physics. Adapt grid bounds to the material
    // rectangle while preserving the original square path byte for byte.
    let heuristic = &text[text.find("#[inline(always)]\nfn heuristic(").unwrap()..text.find("struct ImgDiffWeights").unwrap()];
    let preview = text[text.find("fn make_new_img(").unwrap()..text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()]
        .replace("(sidelen * sidelen * 3) as usize", "assignments.len() * 3");
    let genetic = &text[text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()..text.find("// fn serialize_assignments").unwrap()];
    // The upstream cast truncates indices above 65,535 before division. Keep
    // the index at usize precision until it becomes a coordinate. This leaves
    // <=256px results, RNG, heuristic, swaps and all fluid physics unchanged.
    let old_coordinates = "let ax = apos as u16 % settings.sidelen as u16;\n            let ay = apos as u16 / settings.sidelen as u16;";
    assert_eq!(genetic.matches(old_coordinates).count(), 1,
        "Upstream optimizer coordinates changed; review the native-resolution adapter");
    let mut genetic = genetic.replace(old_coordinates,
        "let ax = (apos % settings.sidelen as usize) as u16;\n            let ay = (apos / settings.sidelen as usize) as u16;");
    let old_y = "let by = (ay as i16 + rng.gen_range(-(max_dist as i16)..(max_dist as i16 + 1)))\n                .clamp(0, settings.sidelen as i16 - 1) as u16;";
    assert_eq!(genetic.matches(old_y).count(), 1);
    genetic = genetic.replace(old_y, &old_y.replace("settings.sidelen as i16 - 1", "settings.height as i16 - 1"))
        .replace("height: settings.sidelen,", "height: settings.height,")
        .replace("let mut max_dist = settings.sidelen;", "let mut max_dist = settings.sidelen.max(settings.height);")
        .replace("max_dist as f32 / settings.sidelen as f32", "max_dist as f32 / settings.sidelen.max(settings.height) as f32");
    let generated = format!("{}\n{}\n{}", heuristic, preview, genetic);
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("calculate.rs"), generated).unwrap();
    let motion = fs::read_to_string(root.join("vendor/obamify/src/app/morph_sim.rs")).unwrap().replace("\r\n", "\n");
    // A non-square particle count needs a whole-number spatial hash grid.
    // This changes only bucket allocation; every original force stays intact.
    let old_grid = "let grid_size = (self.cells.len() as f32).sqrt();";
    assert_eq!(motion.matches(old_grid).count(), 1);
    let motion = motion.replace(old_grid, "let grid_size = (self.cells.len() as f32).sqrt().ceil();")
        .replace("let mut grid = vec![vec![]; self.cells.len()];", "let mut grid = vec![vec![]; (grid_size * grid_size) as usize];");
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("morph_sim.rs"), motion).unwrap();
    println!("cargo:rerun-if-changed={}", source_path.display());
    println!("cargo:rerun-if-changed=../vendor/obamify/src/app/morph_sim.rs");
}

