// The mountains, worked out once into a picture of heights (and again whenever their look is changed): the
// ray march then reads a height in one go, where the erosion filter (erosion.wgsl, joined on in front of
// this) would have it add up eighty waves. The land is a square from -1 to 1 with a flat-floored valley
// running across it along x, for the river.

struct Land {
  seed: vec4f, // xy: moves all the noise; z: how many big shapes across; w: how much of the finer shapes
  tall: vec4f, // the far side's height; the near side's; how much of it is there whatever the noise; all heights times this
  valley: vec4f, // half the floor's width; the width of the mountains' foot; how far the valley swings, how often
  axis: vec4f, // the swing's phase; the valley's middle; bumps on the floor; how ragged the valley's sides are
  gully: vec4f, // the widest gullies' width; their strength; their weight; how far the fine ones reach
  rounding: vec4f, // of ridges; of creases; of the smooth land's own; per octave
  onset: vec4f, // how soon gullies come with slope: on the land, on each octave; the same two for the ridge map
  more: vec4f, // the slope assumed, and how much it is used in place of the real one; cell size; blend strength given back
  last: vec4f, // octaves; each how much finer; and weaker; the picture's width in cells
};
@group(0) @binding(0) var<uniform> L: Land;

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

// about -1 to 1
fn shapes(q: vec2f) -> f32 {
  var sum = 0.0;
  var most = 0.0;
  var a = 1.0;
  var f = L.seed.z;
  for (var i = 0; i < 3; i++) {
    sum += a * noised(q * f + L.seed.xy + f32(i) * 7.3).x;
    most += a;
    a *= L.seed.w;
    f *= 2.0;
  }
  return 1.6 * sum / most;
}

// the valley's middle line: z for an x
fn axisAt(x: f32) -> f32 {
  return L.axis.y + L.valley.z * sin(x * L.valley.w + L.axis.x);
}

// The smooth land before it is worn, over the unit square: a flat floor, and to each side of it mountains
// whose foot is a ragged line.
fn smoothLand(q: vec2f) -> f32 {
  let w = q * 2.0 - 1.0;
  let d = w.y - axisAt(w.x);
  let ragged = L.axis.w * noised(q * 3.1 + L.seed.xy + 31.7).x;
  let side = smoothstep(0.0, 1.0, (abs(d) + ragged - L.valley.x) / L.valley.y);
  let top = select(L.tall.x, L.tall.y, d > 0.0);
  let f = clamp(shapes(q) * 0.5 + 0.5, 0.0, 1.0);
  let bumps = L.axis.z * (noised(q * 9.0 + L.seed.xy + 3.1).x + 0.5 * noised(q * 21.0 + L.seed.xy).x);
  return side * top * mix(f, 1.0, L.tall.z) + bumps * (1.0 - 0.7 * side);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let q = at.xy / L.last.w;
  let e = 0.0015;
  let h = smoothLand(q);
  let slope = vec2f(smoothLand(q + vec2f(e, 0.0)) - smoothLand(q - vec2f(e, 0.0)), smoothLand(q + vec2f(0.0, e)) - smoothLand(q - vec2f(0.0, e))) / (2.0 * e);

  // -1 on the valley floor, 1 at the height of the far side's tops
  let fadeTarget = clamp(h / (0.5 * L.tall.x) - 1.0, -1.0, 1.0);
  let er = erosionFilter(
    q,
    vec3f(h, slope),
    fadeTarget,
    L.gully.y,
    L.gully.z,
    L.gully.w,
    L.rounding,
    L.onset,
    L.more.xy,
    L.gully.x,
    i32(L.last.x),
    L.last.y,
    L.last.z,
    L.more.z,
    L.more.w,
    L.seed.xy,
  );
  // On flat ground the filter takes off all it can (it fades to -1 there); that is put back, so the floor of
  // the valley stays at 0. Times 2, as the land is 2 across and the filter's square 1.
  let y = 2.0 * L.tall.w * (h + er.delta.x + er.magnitude);
  // The height goes out in two parts, a coarse one that a 16 bit float holds exactly and the small rest: read
  // back smoothly and added, they give the height far finer than one such float could.
  let coarse = floor(y * 32.0 + 0.5) / 32.0;
  return vec4f(coarse, y - coarse, er.ridges, 2.0 * L.tall.w * h);
}
