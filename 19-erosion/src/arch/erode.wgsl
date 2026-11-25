// One step of the wear. Rock goes from the surface inward: a cell loses rock as fast as it is soft, open to the air
// and sheltered.

@group(0) @binding(1) var<storage, read> made: array<vec2f>;  // softness; distance to the first surface
@group(0) @binding(2) var<storage, read> was: array<f32>;
@group(0) @binding(3) var<storage, read_write> next: array<f32>;
// the coarse field is bound at 4, what holds the rock up at 7
@group(0) @binding(5) var<storage, read_write> born: array<vec4f>;  // where sand came off in this step
@group(0) @binding(6) var<storage, read_write> tally: array<atomic<u32>, 4>;

@compute @workgroup_size(4, 4, 4)
fn erode(@builtin(global_invocation_id) id: vec3u) {
  let n = cells();
  if (any(id >= n)) {
    return;
  }
  let c = vec3i(id);
  let i = id.x + n.x * (id.y + n.y * id.z);
  let m = made[i];
  let full = fill(m.y);
  if (full <= 0.0) {
    next[i] = 0.0;
    return;
  }
  let d = was[i];
  if (d <= 0.0) {
    next[i] = 0.0;
    return;
  }
  let p = place(vec3f(id));
  // the wear does not start everywhere at once
  let late = P.time.z * smoothstep(0.25, 0.75, noise(p * 1.7 + 5.0));
  let wearing = P.time.y * smoothstep(late, late + 0.15, P.time.x);

  // the cells around: how much air touches this one, and which way the rock lies
  var open = 0.0;
  var into = vec3f(0.0);
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3i(x, y, z);
        let far = x * x + y * y + z * z;
        if (far == 0) {
          continue;
        }
        let v = was[cellAt(c + o)];
        let w = 1.0 / f32(far);
        open += w * (1.0 - v);
        into += w * v * vec3f(o);
      }
    }
  }
  open /= 14.6667;

  let around = wideAt(vec3f(id)); // how much rock there is in the wider surroundings, 0 … 1
  let soft = pow(m.x, P.wear.y) + P.more.z;
  // tafoni: sheltered rock stays damp and weakens faster, so a pit deepens into a cave and its rim stays
  let shelter = 1.0 + P.wear.z * smoothstep(0.45, 0.8, around);
  // crumbs: rock with almost nothing around it, and threads one cell thin, go whatever they are made of
  let crumb = max(1.0 - smoothstep(0.02, 0.06, around), smoothstep(0.78, 0.9, open));
  // faces turned into the wind wear faster, and those near the ground, where the wind carries the most sand
  var blown = 1.0 + P.time.w * exp(-max(p.y, 0.0) / P.blow.y);
  let len = length(into);
  if (len > 1e-4) {
    blown *= max(1.0 + P.blow.x * dot(into / len, P.wind.xyz), 0.2);
  }
  // a piece that has come loose from the arch falls apart
  let loose = 1.0 - smoothstep(0.0, 0.01, heldAt(vec3f(id)));
  let take = min(d, P.wear.x * (wearing * (soft * shelter * blown + P.wear.w * crumb) + P.foam2.z * loose) * open);
  // a few of the cells that lost rock send out a grain of sand
  if (take > 0.004 && open > 0.1) {
    let dice = rand3(c + vec3i(i32(P.low.w) * 7, i32(P.low.w) * 13, 0));
    if (dice.x < take * P.foam2.w) {
      let slot = atomicAdd(&tally[1], 1u);
      if (slot < arrayLength(&born)) {
        born[slot] = vec4f(p + (dice - 0.5) * P.grid.w, take);
      }
    }
  }
  next[i] = d - take;
}
