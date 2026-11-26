// The coarse field: one number for every 4×4×4 cells, blurred. It says how much rock there is around a place.

@group(0) @binding(WIDE) var<storage, read> wide: array<f32>;

fn wideCell(c: vec3i) -> f32 {
  let n = vec3i((cells() + 3u) / 4u);
  let k = clamp(c, vec3i(0), n - 1);
  return wide[k.x + n.x * (k.y + n.y * k.z)];
}
// read at a grid position, blended between the eight coarse cells around it
fn wideAt(c: vec3f) -> f32 {
  let q = (c - 1.5) / 4.0;
  let i = vec3i(floor(q));
  let f = fract(q);
  let a = mix(wideCell(i), wideCell(i + vec3i(1, 0, 0)), f.x);
  let b = mix(wideCell(i + vec3i(0, 1, 0)), wideCell(i + vec3i(1, 1, 0)), f.x);
  let e = mix(wideCell(i + vec3i(0, 0, 1)), wideCell(i + vec3i(1, 0, 1)), f.x);
  let g = mix(wideCell(i + vec3i(0, 1, 1)), wideCell(i + vec3i(1, 1, 1)), f.x);
  return mix(mix(a, b, f.y), mix(e, g, f.y), f.z);
}

@group(0) @binding(HELD) var<storage, read> held: array<f32>;

fn heldCell(c: vec3i) -> f32 {
  let n = vec3i((cells() + 1u) / 2u);
  let k = clamp(c, vec3i(0), n - 1);
  return held[k.x + n.x * (k.y + n.y * k.z)];
}
// whether the rock at a grid position still hangs on the ring: above zero if any of the cells round it does.
// These cells are 2×2×2 of the grid's.
fn heldAt(c: vec3f) -> f32 {
  let q = (c - 0.5) / 2.0;
  let i = vec3i(floor(q));
  let f = fract(q);
  let a = mix(heldCell(i), heldCell(i + vec3i(1, 0, 0)), f.x);
  let b = mix(heldCell(i + vec3i(0, 1, 0)), heldCell(i + vec3i(1, 1, 0)), f.x);
  let e = mix(heldCell(i + vec3i(0, 0, 1)), heldCell(i + vec3i(1, 0, 1)), f.x);
  let g = mix(heldCell(i + vec3i(0, 1, 1)), heldCell(i + vec3i(1, 1, 1)), f.x);
  return mix(mix(a, b, f.y), mix(e, g, f.y), f.z);
}
