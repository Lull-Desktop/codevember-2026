// Marching cubes: every cube of eight neighbouring cells that the surface passes through writes its triangles
// into one long list. A shared counter hands each cube its place in the list.

struct Corner {
  at: vec4f,  // place in the rock's space; how open to the sky
  nor: vec4f, // which way the surface faces; depth below the first surface
};

@group(0) @binding(1) var<storage, read> field: array<f32>;  // the smoothed rock
@group(0) @binding(2) var<storage, read> made: array<vec2f>;
// the coarse field is bound at 3, what holds the rock up at 8
@group(0) @binding(4) var<storage, read> cases: array<i32>;  // for each of the 256 cubes, the edges its triangles use
@group(0) @binding(5) var<storage, read_write> list: array<Corner>;
@group(0) @binding(6) var<storage, read_write> tally: array<atomic<u32>, 4>;
@group(0) @binding(7) var<storage, read_write> draw: array<u32, 4>;

// corners of a cube and the pairs of them that make its twelve edges, in the usual order (Bourke)
const CORNER = array<vec3i, 8>(
  vec3i(0, 0, 0), vec3i(1, 0, 0), vec3i(1, 1, 0), vec3i(0, 1, 0),
  vec3i(0, 0, 1), vec3i(1, 0, 1), vec3i(1, 1, 1), vec3i(0, 1, 1));
const EDGE = array<vec2u, 12>(
  vec2u(0, 1), vec2u(1, 2), vec2u(2, 3), vec2u(3, 0), vec2u(4, 5), vec2u(5, 6),
  vec2u(6, 7), vec2u(7, 4), vec2u(0, 4), vec2u(1, 5), vec2u(2, 6), vec2u(3, 7));

fn fieldAt(c: vec3f) -> f32 {
  let i = vec3i(floor(c));
  let f = fract(c);
  let a = mix(field[cellAt(i)], field[cellAt(i + vec3i(1, 0, 0))], f.x);
  let b = mix(field[cellAt(i + vec3i(0, 1, 0))], field[cellAt(i + vec3i(1, 1, 0))], f.x);
  let e = mix(field[cellAt(i + vec3i(0, 0, 1))], field[cellAt(i + vec3i(1, 0, 1))], f.x);
  let g = mix(field[cellAt(i + vec3i(0, 1, 1))], field[cellAt(i + vec3i(1, 1, 1))], f.x);
  return mix(mix(a, b, f.y), mix(e, g, f.y), f.z);
}
// which way the rock gets fuller at a cell
fn slope(c: vec3i) -> vec3f {
  return vec3f(
    field[cellAt(c + vec3i(1, 0, 0))] - field[cellAt(c - vec3i(1, 0, 0))],
    field[cellAt(c + vec3i(0, 1, 0))] - field[cellAt(c - vec3i(0, 1, 0))],
    field[cellAt(c + vec3i(0, 0, 1))] - field[cellAt(c - vec3i(0, 0, 1))]);
}

@compute @workgroup_size(4, 4, 4)
fn march(@builtin(global_invocation_id) id: vec3u) {
  let n = cells();
  if (any(id >= n - 1u)) {
    return;
  }
  let c = vec3i(id);
  var v: array<f32, 8>;
  var kind = 0u;
  for (var k = 0u; k < 8u; k++) {
    v[k] = field[cellAt(c + CORNER[k])];
    if (v[k] < 0.5) {
      kind |= 1u << k;
    }
  }
  if (kind == 0u || kind == 255u) {
    return;
  }
  var count = 0u;
  while (count < 15u && cases[kind * 16u + count] >= 0) {
    count++;
  }
  let first = atomicAdd(&tally[0], count);
  if (first + count > arrayLength(&list)) {
    return;
  }
  var g: array<vec3f, 8>;
  var sd: array<f32, 8>;
  for (var k = 0u; k < 8u; k++) {
    g[k] = slope(c + CORNER[k]);
    sd[k] = made[cellAt(c + CORNER[k])].y;
  }
  for (var k = 0u; k < count; k++) {
    let e = EDGE[cases[kind * 16u + k]];
    let t = clamp((0.5 - v[e.x]) / (v[e.y] - v[e.x]), 0.0, 1.0);
    let at = vec3f(c) + mix(vec3f(CORNER[e.x]), vec3f(CORNER[e.y]), t);
    var nor = -mix(g[e.x], g[e.y], t);
    let len = length(nor);
    if (len > 1e-6) {
      nor /= len;
    } else {
      nor = vec3f(0.0, 1.0, 0.0);
    }
    // how open the place is: rock found a little way out along the normal, near and far, closes it
    let near = fieldAt(at + nor * 1.6) + fieldAt(at + nor * 3.2);
    let far = wideAt(at + nor * 5.0) + wideAt(at + nor * 10.0);
    let open = clamp(1.0 - 0.45 * near, 0.0, 1.0) * clamp(1.15 - 1.1 * far, 0.0, 1.0);
    // depth below the first surface; kept below −1 for a piece that has come loose from the ring
    var depth = max(-mix(sd[e.x], sd[e.y], t), 0.0);
    if (heldAt(at) <= 0.0) {
      depth = -1.0 - depth;
    }
    list[first + k] = Corner(vec4f(place(at), open), vec4f(nor, depth));
  }
}

// the count for the draw call, kept within the list
@compute @workgroup_size(1)
fn finish() {
  draw[0] = min(atomicLoad(&tally[0]), arrayLength(&list));
  draw[1] = 1u;
  draw[2] = 0u;
  draw[3] = 0u;
}
