use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let source_path = root.join("vendor/obamify/src/app/calculate/mod.rs");
    let text = fs::read_to_string(&source_path).unwrap().replace("\r\n", "\n");
    // Reuse the upstream bodies, excluding GUI/module scaffolding. The only
    // compatibility fix below widens flattened-index arithmetic for native images.
    let heuristic = &text[text.find("#[inline(always)]\nfn heuristic(").unwrap()..text.find("struct ImgDiffWeights").unwrap()];
    let preview = &text[text.find("fn make_new_img(").unwrap()..text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()];
    let genetic = &text[text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()..text.find("// fn serialize_assignments").unwrap()];
    // The upstream cast truncates indices above 65,535 before division. Keep
    // the index at usize precision until it becomes a coordinate. This leaves
    // <=256px results, RNG, heuristic, swaps and all fluid physics unchanged.
    let old_coordinates = "let ax = apos as u16 % settings.sidelen as u16;\n            let ay = apos as u16 / settings.sidelen as u16;";
    assert_eq!(genetic.matches(old_coordinates).count(), 1,
        "Upstream optimizer coordinates changed; review the native-resolution adapter");
    let genetic = genetic.replace(old_coordinates,
        "let ax = (apos % settings.sidelen as usize) as u16;\n            let ay = (apos / settings.sidelen as usize) as u16;");
    let generated = format!("{}\n{}\n{}", heuristic, preview, genetic);
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("calculate.rs"), generated).unwrap();
    println!("cargo:rerun-if-changed={}", source_path.display());
    println!("cargo:rerun-if-changed=../vendor/obamify/src/app/morph_sim.rs");
}

