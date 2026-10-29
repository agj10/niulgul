//! Browser ABI around upstream matching and fluid forces, with rectangular grid bounds.
use std::cell::RefCell;
use image::{RgbImage, imageops};

#[link(wasm_import_module = "env")]
extern "C" { fn progress(value: f32); }

pub mod app {
    #[derive(Clone, Copy)]
    pub struct SeedPos { pub xy: [f32; 2] }
    #[derive(Clone, Copy)]
    pub struct SeedColor { pub rgba: [f32; 4] }
    pub mod preset {
        pub struct UnprocessedPreset { pub name: String, pub width: u32, pub height: u32, pub source_img: Vec<u8> }
        pub struct Preset { pub inner: UnprocessedPreset, pub assignments: Vec<usize> }
    }
    pub mod morph_sim {
        include!(concat!(env!("OUT_DIR"), "/morph_sim.rs"));
        pub fn init_rect(width: u32, height: u32, assignments: &[usize]) -> (Vec<super::SeedPos>, Sim) {
            let mut sim = Sim::new("niulgul".into());
            let n = (width * height) as usize;
            sim.cells = vec![CellBody::new(0.0, 0.0, 0.0, 0.0, 0.13); n];
            let mut positions = Vec::with_capacity(n);
            let step_x = 1024.0 / width as f32;
            let step_y = 1024.0 / height as f32;
            for i in 0..n {
                positions.push(super::SeedPos { xy: [((i as u32 % width) as f32 + 0.5) * step_x,
                    ((i as u32 / width) as f32 + 0.5) * step_y] });
            }
            for (dst, &src) in assignments.iter().enumerate() {
                sim.cells[src] = CellBody::new(positions[src].xy[0], positions[src].xy[1],
                    ((dst as u32 % width) as f32 + 0.5) * step_x,
                    ((dst as u32 / width) as f32 + 0.5) * step_y, 0.13);
            }
            (positions, sim)
        }
    }
    pub mod calculate {
        use super::preset::{Preset, UnprocessedPreset};
        pub struct GenerationSettings {
            pub sidelen: u32, pub height: u32, pub proximity_importance: i64,
            pub target: Vec<(u8,u8,u8)>, pub weights: Vec<i64>,
        }
        pub enum ProgressMsg {
            Done(Preset), UpdatePreview { width: u32, height: u32, data: Vec<u8> }, Progress(f32),
        }
        pub mod util {
            pub use super::GenerationSettings;
            pub trait ProgressSink { fn send(&mut self, value: super::ProgressMsg); }
            impl<T: FnMut(super::ProgressMsg)> ProgressSink for T {
                fn send(&mut self, value: super::ProgressMsg) { self(value); }
            }
            // Images have already gone through the original center crop and
            // Lanczos3 sampling below. This adapter only transports their bytes.
            pub fn get_images(source: image::RgbImage, settings: &GenerationSettings)
              -> Result<(Vec<(u8,u8,u8)>,Vec<(u8,u8,u8)>,Vec<i64>),Box<dyn std::error::Error>> {
                Ok((source.pixels().map(|p|(p[0],p[1],p[2])).collect(), settings.target.clone(), settings.weights.clone()))
            }
        }
        use util::ProgressSink;
        include!(concat!(env!("OUT_DIR"), "/calculate.rs"));
    }
}

#[derive(Default)]
struct State {
    sw: u32, sh: u32, tw: u32, th: u32,
    input_source: Vec<u8>, input_target: Vec<u8>,
    source: Vec<u8>, assignments: Vec<usize>, normalized: Vec<f32>,
    sim: Option<(Vec<app::SeedPos>, app::morph_sim::Sim)>, frame: u32, side: u32, rows: u32,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

fn crop_scale(img: &RgbImage, side: u32) -> RgbImage {
    // CropScale::identity().apply from upstream calculate/util.rs.
    let (w,h) = img.dimensions();
    let cs = w.min(h);
    let x0 = ((w-cs) as f32 * 0.5).floor() as u32;
    let y0 = ((h-cs) as f32 * 0.5).floor() as u32;
    let cropped = imageops::crop_imm(img,x0,y0,cs,cs).to_image();
    if cs == side { cropped } else { imageops::resize(&cropped,side,side,imageops::FilterType::Lanczos3) }
}
fn rgb(w:u32,h:u32,data:&[u8]) -> RgbImage {
    RgbImage::from_vec(w,h,data.chunks_exact(4).flat_map(|p|[p[0],p[1],p[2]]).collect()).unwrap()
}
fn crop_aspect(img: &RgbImage, width: u32, height: u32) -> RgbImage {
    if width == height { return crop_scale(img, width); }
    let (w,h) = img.dimensions();
    let (cw,ch) = if w as u64 * height as u64 > h as u64 * width as u64 {
        (((h as u64 * width as u64 / height as u64) as u32).max(1), h)
    } else { (w, ((w as u64 * height as u64 / width as u64) as u32).max(1)) };
    let cropped = imageops::crop_imm(img, (w-cw)/2, (h-ch)/2, cw, ch).to_image();
    if cw == width && ch == height { cropped } else { imageops::resize(&cropped,width,height,imageops::FilterType::Lanczos3) }
}
fn tone_image(img: &mut RgbImage, tone:u32) {
    // Optional input preparation. At 100 this is a strict no-op, so the
    // default passes original RGB bytes and weights to the upstream optimizer.
    if tone >= 100 { return; }
    let mix = tone as f32 / 100.0;
    for p in img.pixels_mut() {
        let l = 0.2126*p[0] as f32 + 0.7152*p[1] as f32 + 0.0722*p[2] as f32;
        for c in &mut p.0 { *c = (l*(1.0-mix)+*c as f32*mix).round().clamp(0.0,255.0) as u8; }
    }
}

#[no_mangle]
pub extern "C" fn prepare(sw:u32,sh:u32,tw:u32,th:u32) {
    STATE.with(|s| {let mut s=s.borrow_mut();s.sw=sw;s.sh=sh;s.tw=tw;s.th=th;s.input_source.resize((sw*sh*4) as usize,0);s.input_target.resize((tw*th*4) as usize,0);});
}
#[no_mangle] pub extern "C" fn input_source_pointer() -> *mut u8 { STATE.with(|s|s.borrow_mut().input_source.as_mut_ptr()) }
#[no_mangle] pub extern "C" fn input_target_pointer() -> *mut u8 { STATE.with(|s|s.borrow_mut().input_target.as_mut_ptr()) }
#[no_mangle] pub extern "C" fn source_pointer() -> *mut u8 { STATE.with(|s|s.borrow_mut().source.as_mut_ptr()) }
#[no_mangle] pub extern "C" fn assignment_pointer() -> *mut usize { STATE.with(|s|s.borrow_mut().assignments.as_mut_ptr()) }

#[no_mangle]
pub extern "C" fn solve(side:u32,proximity:i32,tone:u32,builtin:u32,identity:u32) {
    solve_grid(side,side,proximity,tone,builtin,identity,false);
}
#[no_mangle]
pub extern "C" fn solve_rect(width:u32,height:u32,proximity:i32,tone:u32,builtin:u32,identity:u32) {
    solve_grid(width,height,proximity,tone,builtin,identity,true);
}
fn solve_grid(side:u32,rows:u32,proximity:i32,tone:u32,builtin:u32,identity:u32,rectangular:bool) {
    STATE.with(|state| {
        let mut s=state.borrow_mut(); s.side=side;s.rows=rows;
        let source_image=rgb(s.sw,s.sh,&s.input_source);
        let original_source=if rectangular {
            if source_image.dimensions()==(side,rows) { source_image }
            else { imageops::resize(&source_image,side,rows,imageops::FilterType::Lanczos3) }
        }else{crop_scale(&source_image,side)};
        let mut target=if builtin!=0 {
            crop_aspect(&image::load_from_memory(include_bytes!("../../public/reference/target256.png")).unwrap().to_rgb8(),side,rows)
        }else{crop_aspect(&rgb(s.tw,s.th,&s.input_target),side,rows)};
        let weights=if builtin!=0 {
            crop_aspect(&image::load_from_memory(include_bytes!("../../public/reference/weights256.png")).unwrap().to_rgb8(),side,rows)
                .pixels().map(|p|p[0] as i64).collect()
        }else{vec![255; (side*rows) as usize]};
        s.source=original_source.pixels().flat_map(|p|[p[0],p[1],p[2],255]).collect();
        if identity!=0 { s.assignments=(0..(side*rows) as usize).collect(); return; }
        let mut source=original_source; tone_image(&mut source,tone);tone_image(&mut target,tone);
        let settings=app::calculate::GenerationSettings{sidelen:side,height:rows,proximity_importance:proximity as i64,
            target:target.pixels().map(|p|(p[0],p[1],p[2])).collect(),weights};
        let input=app::preset::UnprocessedPreset{name:"niulgul".into(),width:side,height:rows,source_img:source.into_raw()};
        let mut answer=None;
        let mut sink=|msg|match msg{
            app::calculate::ProgressMsg::Done(p)=>answer=Some(p.assignments),
            app::calculate::ProgressMsg::Progress(p)=>unsafe{progress(p)},
            _=>{},
        };
        app::calculate::process_genetic(input,settings,&mut sink).unwrap();
        s.assignments=answer.unwrap();
    });
}
#[no_mangle]
pub extern "C" fn sim_reserve(side:u32) {
    sim_reserve_rect(side,side);
}
#[no_mangle]
pub extern "C" fn sim_reserve_rect(width:u32,height:u32) {
    STATE.with(|s|{let mut s=s.borrow_mut();s.side=width;s.rows=height;s.assignments.resize((width*height)as usize,0);});
}
#[no_mangle]
pub extern "C" fn sim_start() {
    STATE.with(|s|{
        let mut s=s.borrow_mut();let side=s.side;
        let (positions,sim)=if side==s.rows {
            let preset=app::preset::Preset{inner:app::preset::UnprocessedPreset{name:"niulgul".into(),width:side,height:side,source_img:vec![0;(side*side*3)as usize]},assignments:s.assignments.clone()};
            let (_,positions,_,sim)=app::morph_sim::init_image(1024,preset); (positions,sim)
        }else{app::morph_sim::init_rect(side,s.rows,&s.assignments)};
        s.normalized.resize(positions.len()*2,0.0);s.sim=Some((positions,sim));s.frame=0;
        update_normalized(&mut s);
    });
}
fn update_normalized(s:&mut State) {
    let positions=&s.sim.as_ref().unwrap().0;
    for (i,p) in positions.iter().enumerate(){s.normalized[i*2]=p.xy[0]/1024.0;s.normalized[i*2+1]=p.xy[1]/1024.0;}
}
#[no_mangle]
pub extern "C" fn sim_advance(frame:u32) {
    STATE.with(|s|{let mut s=s.borrow_mut();while s.frame<frame {
        let (positions,sim)=s.sim.as_mut().unwrap();sim.update(positions,1024);s.frame+=1;
    }update_normalized(&mut s);});
}
#[no_mangle] pub extern "C" fn positions_pointer() -> *mut f32 { STATE.with(|s|s.borrow_mut().normalized.as_mut_ptr()) }
#[no_mangle]
pub extern "C" fn sim_error() -> f32 {
    STATE.with(|s|{let s=s.borrow();let positions=&s.sim.as_ref().unwrap().0;let step=1024.0/s.side as f32;let step_y=1024.0/s.rows as f32;
        s.assignments.iter().enumerate().map(|(dst,&src)|{
            let x=(dst as u32%s.side)as f32+0.5;let y=(dst as u32/s.side)as f32+0.5;
            let dx=positions[src].xy[0]-x*step;let dy=positions[src].xy[1]-y*step_y;(dx*dx+dy*dy).sqrt()
        }).fold(0.0_f32,f32::max)
    })
}

