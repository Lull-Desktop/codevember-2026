// Put in front of every shader of the page: the numbers the page sends, the grid, the noise, the arch and its rock.

struct Params {
  grid: vec4f,   // cells along x, y, z; size of a cell
  low: vec4f,    // corner of the grid in the rock's own space; steps taken so far
  arch: vec4f,   // outer radius, inner radius, height the round part starts at, how far the feet spread
  deep: vec4f,   // half depth at the feet, at the crown, rounding of the edges; seed
  strata: vec4f, // layers in a unit of height, tilt, warp, scale of the warp
  seeds: vec4f,  // size of a cavity cell, squash across the layers, part of the seeds that grow, width of a wall in cells
  rock: vec4f,   // how soft the soft layers are, how much the massive blotches resist, scale of the blotches, crust depth
  wear: vec4f,   // rate, power on softness, boost for sheltered rock, how fast crumbs go
  time: vec4f,   // how far through the wear, 0 … 1; how fast it goes just now; how unevenly it starts; extra near the ground
  blow: vec4f,   // pull of the wind; how far up the ground's extra wear reaches; hardness of the core; its reach
  wind: vec4f,   // where the wind blows to, in the rock's space; rind depth
  more: vec4f,   // width of the first edge in cells; smoothing of the meshed field; wear everywhere; -
  foam: vec4f,   // reach of the smallest cavity in cells; where a window between two starts, as part of the reach; hardness of the shelves; reach of the biggest
  foam2: vec4f,  // how bent the cavities are; size of a window in the crust, as part of the reach; how fast loose pieces go; how much sand
  foam3: vec4f,  // size of the small cavities as part of the big; part of their seeds that grow
};
@group(0) @binding(0) var<uniform> P: Params;

const TAU = 6.2831853;

fn cells() -> vec3u {
  return vec3u(P.grid.xyz);
}
// the place of a cell in the long array; cells off the grid read the nearest one, which is always air
fn cellAt(c: vec3i) -> u32 {
  let n = vec3i(cells());
  let k = clamp(c, vec3i(0), n - 1);
  return u32(k.x + n.x * (k.y + n.y * k.z));
}
// the point in the rock's space a grid position stands for
fn place(c: vec3f) -> vec3f {
  return P.low.xyz + (c + 0.5) * P.grid.w;
}

// ---- noise

fn pcg3(v: vec3u) -> vec3u {
  var x = v * 1664525u + 1013904223u;
  x.x += x.y * x.z;
  x.y += x.z * x.x;
  x.z += x.x * x.y;
  x ^= x >> vec3u(16u);
  x.x += x.y * x.z;
  x.y += x.z * x.x;
  x.z += x.x * x.y;
  return x;
}
fn rand3(c: vec3i) -> vec3f {
  return vec3f(pcg3(bitcast<vec3u>(c))) / 4294967296.0;
}
fn rand1(c: vec3i) -> f32 {
  return rand3(c).x;
}
fn noise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(rand1(i), rand1(i + vec3i(1, 0, 0)), u.x);
  let b = mix(rand1(i + vec3i(0, 1, 0)), rand1(i + vec3i(1, 1, 0)), u.x);
  let c = mix(rand1(i + vec3i(0, 0, 1)), rand1(i + vec3i(1, 0, 1)), u.x);
  let d = mix(rand1(i + vec3i(0, 1, 1)), rand1(i + vec3i(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
fn fbm(p: vec3f) -> f32 {
  var q = p;
  var sum = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 4; i++) {
    sum += amp * noise(q);
    q = q * 2.03 + vec3f(13.1, 7.7, 3.3);
    amp *= 0.5;
  }
  return sum / 0.9375;
}

// ---- the arch

// distance to the arch before any wear, below zero inside. It stands on y = 0 and spans x: a round top on two legs
// that spread a little towards the ground.
fn archFlat(p: vec3f) -> vec2f {
  let q = vec2f(abs(p.x), p.y - P.arch.z);
  let low = clamp(-q.y / P.arch.z, 0.0, 1.3);
  let spread = P.arch.w * low * low;
  var outer = q.x - P.arch.x - spread;
  var inner = q.x - P.arch.y + 0.35 * spread;
  if (q.y > 0.0) {
    outer = length(q) - P.arch.x;
    inner = length(q * vec2f(1.0, 0.94)) - P.arch.y;
  }
  return vec2f(outer, -inner);
}
fn archDist(p: vec3f) -> f32 {
  let f = archFlat(p);
  let r = P.deep.z;
  let hz = mix(P.deep.x, P.deep.y, smoothstep(0.0, 1.0, p.y / (P.arch.z + P.arch.x)));
  let e = vec3f(f, abs(p.z) - hz) + r;
  return length(max(e, vec3f(0.0))) + min(max(e.x, max(e.y, e.z)), 0.0) - r;
}
// how full a cell is at a distance from the first surface
fn fill(sd: f32) -> f32 {
  return clamp(0.5 - sd / (P.more.x * P.grid.w), 0.0, 1.0);
}

// ---- the rock

// which layer a point is in: whole numbers count layers. The layers lie flat in the block the arch was cut from,
// a little tilted and bent.
fn layerAt(p: vec3f) -> f32 {
  let seed = P.deep.w * 7.31;
  let bend = fbm(p * P.strata.w + seed) - 0.5;
  let fine = noise(p * vec3f(5.0, 1.0, 5.0) + seed) - 0.5;
  return (p.y + P.strata.y * p.x + 0.4 * P.strata.y * p.z + P.strata.z * (bend + 0.12 * fine)) * P.strata.x;
}
// a number that stays the same within a layer and differs between layers, 0 … 1
fn layerRand(s: f32, k: i32) -> f32 {
  let i = i32(floor(s));
  let f = smoothstep(0.3, 0.7, fract(s));
  let seed = i32(P.deep.w);
  return mix(rand1(vec3i(i, k, seed)), rand1(vec3i(i + 1, k, seed)), f);
}
// how hard the layer is, 0 soft … 1 hard: thick beds of one kind with thin beds of another inside them
fn layerHard(s: f32) -> f32 {
  return clamp(0.55 * layerRand(s, 0) + 0.45 * layerRand(s * 0.23 + 5.3, 1) + 0.25 * (layerRand(s * 2.7, 2) - 0.5), 0.0, 1.0);
}

// The rock is a sponge in waiting: seeds scattered through it, each the heart of a round cavity of its own size.
// A cavity stops at the wall half way to the next seed, unless both reach that far: then they join through a
// round window in the wall. What no cavity reaches stays as the bridges.
struct Foam {
  near: vec2f, // distances to the two nearest seeds, in cells
  size: f32,   // how far the cavity of the nearest seed reaches, in cells; 0 if that part of the rock is massive
};
// size is the size of a cell; odds, the part of the seeds that grow; which, a number that tells the scatterings apart
fn foamAt(p: vec3f, size: f32, odds: f32, which: i32) -> Foam {
  var q = p / size;
  // cavities are lenses lying along the layers
  q.y *= P.seeds.y;
  // bent, so the cavities are not quite balls
  q += (vec3f(noise(q * 0.9 + 3.1), noise(q * 0.9 + 11.9), noise(q * 0.9 + 23.3)) - 0.5) * P.foam2.x;
  let c = vec3i(floor(q));
  let seed = i32(P.deep.w) * 17 + which * 1013;
  var near = vec2f(9.0);
  var first = vec3i(0);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cc = c + vec3i(x, y, z);
        let d = length(vec3f(cc) + rand3(cc + vec3i(seed, 0, 0)) - q);
        if (d < near.x) {
          near = vec2f(d, near.x);
          first = cc;
        } else if (d < near.y) {
          near.y = d;
        }
      }
    }
  }
  // massive parts of the block come in big blotches: fewer seeds grow there
  let blot = fbm(vec3f(first) * size * P.rock.z + 31.7 + P.deep.w);
  let grows = odds * (1.0 - P.rock.y * smoothstep(0.4, 0.6, blot));
  let dice = rand3(first + vec3i(0, seed + 91, 0));
  var o: Foam;
  o.near = near;
  o.size = step(dice.x, grows) * mix(P.foam.x, P.foam.w, dice.y);
  return o;
}

// how soft the cavities of one scattering of seeds make the rock at a point; skin is 1 at the first surface
fn cavityAt(p: vec3f, skin: f32, size: f32, odds: f32, which: i32) -> f32 {
  let foam = foamAt(p, size, odds, which);
  let wall = P.seeds.w;
  let far = foam.near.x / max(foam.size, 0.01); // 0 at the heart of the cavity, 1 where it stops
  // a cavity is softest at its heart and hardens towards its edge
  var soft = 1.0 - smoothstep(0.5, 1.0, far);
  // the wall between two cavities, with a round window where this one reaches well past it
  let between = 1.0 - smoothstep(wall, wall * 2.5, foam.near.y - foam.near.x);
  soft *= 1.0 - between * smoothstep(P.foam.y * 0.85, P.foam.y, far);
  // the crust: the first surface is case hardened, and a cavity opens to the air through a window smaller than itself
  soft *= 1.0 - skin * smoothstep(P.foam2.y * 0.8, P.foam2.y, far);
  return soft;
}

// how easily the rock wears at a point, 0 never … 1 at once. sd is the distance to the first surface.
fn softness(p: vec3f, sd: f32) -> f32 {
  let depth = max(-sd, 0.0);
  let s = layerAt(p);
  let lay = layerHard(s);
  let skin = 1.0 - smoothstep(0.4 * P.rock.w, P.rock.w, depth);
  // big cavities, and a scattering of small ones
  var soft = cavityAt(p, skin, P.seeds.x, P.seeds.z, 0);
  soft = max(soft, cavityAt(p, skin, P.seeds.x * P.foam3.x, P.foam3.y, 1));
  // thin hard beds stand through the cavities as shelves
  soft *= 1.0 - P.foam.z * smoothstep(0.8, 0.9, layerRand(s * 2.7, 2));
  // soft layers also weather back a little way from the surface, which leaves the hard ones standing as ledges
  let groove = P.rock.x * smoothstep(0.55, 0.2, lay) * exp(-depth / P.wind.w) * (0.6 + 0.8 * noise(p * 9.0));
  soft = max(soft, groove);
  // a hard core along the middle of the arch keeps it standing: cavities eat into it less
  let f = archFlat(p);
  let core = max(abs(f.x - f.y) * 0.5, abs(p.z)) ;
  soft *= 1.0 - P.blow.z * (1.0 - smoothstep(0.4 * P.blow.w, P.blow.w, core));
  return clamp(soft, 0.0, 1.0);
}
