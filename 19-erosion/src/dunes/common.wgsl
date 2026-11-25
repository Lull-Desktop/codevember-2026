// Put in front of every shader of the page. x is downwind, y up, z towards the eye; metres.

struct Frame {
  eye: vec4f,
  right: vec4f, // .w: half the picture's width at distance 1
  up: vec4f,    // .w: half its height
  ahead: vec4f,
  size: vec4f,  // the picture's width and height; which frame of a still this is; how far through the loop, 0 … 1
  sun: vec4f,   // towards the sun; how big it is (tangent of its radius)
  sunTone: vec4f, // its colour; -
  map: vec4f,   // the dunes' repeat along x and z; how far they have moved along x; size of a cell
  low: vec4f,   // sky: at the horizon under the sun; how bright the sky is
  side: vec4f,  // at the horizon away from it; how much cloud
  mid: vec4f,   // a little above the horizon; how far up that is
  top: vec4f,   // overhead; how much light comes back off the sand
  cloud: vec4f, // clouds; how high the rises far off are
  sand: vec4f,  // the sand; how rough it looks to the light
  haze: vec4f,  // how thick it is; how fast it thins with height; how much it glows towards the sun; where it starts
  drift: vec4f, // blown sand: how thick; how far it goes; how high; how streaky
  fine: vec4f,  // ripples: height, wavelength; streaks; grain of the sand
  walk: vec4f,  // the person: place on the ground, how tall
  pose: vec4f,  // their step (radians); lean; stride; slope of the ground ahead of them
  pose2: vec4f, // how hard they climb; seconds; how far their tracks go; -
  cool: vec4f,  // the sky's light as it falls on the sand; how much of it is that, not the sky as seen
};
@group(0) @binding(0) var<uniform> F: Frame;

const TAU = 6.2831853;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h1(v: u32) -> f32 {
  return f32(pcg(v)) * (1.0 / 4294967296.0);
}
fn h2(x: i32, y: i32, salt: u32) -> f32 {
  return h1((u32(x) * 1597334677u) ^ (u32(y) * 3812015801u) ^ (salt * 2798796415u));
}
// noise that repeats after n cells in x
fn wrapNoise(p: vec2f, n: i32, salt: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let x0 = ((i.x % n) + n) % n;
  let x1 = (((i.x + 1) % n) + n) % n;
  return mix(mix(h2(x0, i.y, salt), h2(x1, i.y, salt), u.x), mix(h2(x0, i.y + 1, salt), h2(x1, i.y + 1, salt), u.x), u.y);
}
fn noise2(p: vec2f, salt: u32) -> f32 {
  return wrapNoise(p, 1 << 20, salt);
}

// the light of the sky on the sand: cooler than the sky looks, as the eye and the film have it
fn skyFall(d: vec3f) -> vec3f {
  return mix(skyTone(d), F.cool.rgb * (0.65 + 0.6 * max(d.y, 0.0)), F.cool.w);
}

// the evening sky, without clouds; smooth enough to light the sand by
fn skyTone(d: vec3f) -> vec3f {
  let flat = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0));
  let sunFlat = normalize(vec3f(F.sun.x, 0.0, F.sun.z));
  let a = dot(flat, sunFlat) * 0.5 + 0.5;
  let e = max(d.y, 0.0);
  let hor = mix(F.side.rgb, F.low.rgb, a * a);
  let mid = F.mid.rgb * mix(0.72, 1.12, a);
  var col = mix(hor, mid, smoothstep(0.0, F.mid.w, e));
  col = mix(col, F.top.rgb, smoothstep(F.mid.w * 0.8, F.mid.w * 3.4, e));
  let m = max(dot(d, F.sun.xyz), 0.0);
  col += F.low.rgb * (0.35 * pow(m, 8.0) + 0.8 * pow(m, 60.0));
  return col * F.low.w;
}
