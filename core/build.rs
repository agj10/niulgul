use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("..");
    let source_path = root.join("vendor/obamify/src/app/calculate/mod.rs");
    let text = fs::read_to_string(&source_path).unwrap().replace("\r\n", "\n");
    // Copy the upstream function bodies verbatim. Only the GUI/module scaffolding
    // is excluded; there is no rewritten optimizer or replacement RNG.
    let heuristic = &text[text.find("#[inline(always)]\nfn heuristic(").unwrap()..text.find("struct ImgDiffWeights").unwrap()];
    let preview = &text[text.find("fn make_new_img(").unwrap()..text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()];
    let genetic = &text[text.find("#[derive(Clone, Copy)]\nstruct Pixel").unwrap()..text.find("// fn serialize_assignments").unwrap()];
    let generated = format!("{}\n{}\n{}", heuristic, preview, genetic);
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("calculate.rs"), generated).unwrap();
    println!("cargo:rerun-if-changed={}", source_path.display());
    println!("cargo:rerun-if-changed=../vendor/obamify/src/app/morph_sim.rs");
}

