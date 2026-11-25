// The start: every cell of the grid gets how full it is (from the distance to the band) and the rock it is made of.

@group(0) @binding(1) var<storage, read_write> made: array<vec2f>; // softness; distance to the first surface
@group(0) @binding(2) var<storage, read_write> rock: array<f32>;   // how full, 0 air … 1 rock
@group(0) @binding(3) var<storage, read_write> twin: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let n = cells();
  if (any(id >= n)) {
    return;
  }
  let i = id.x + n.x * (id.y + n.y * id.z);
  let p = place(vec3f(id));
  let sd = bandDist(p);
  var soft = 0.0;
  if (sd < 2.0 * P.grid.w) {
    soft = softness(p, sd);
  }
  made[i] = vec2f(soft, sd);
  rock[i] = fill(sd);
  twin[i] = fill(sd);
}
