// One step of the wear. Rock goes from the surface inward: a cell loses rock as fast as it is soft, open to the air
// and sheltered. Behind the front that travels round the ring the wear is on; further back the rock comes back.

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
  var d = was[i];
  let p = place(vec3f(id));
  // how far behind the front this cell is, in laps; the front is a little ragged
  let ragged = P.more.w * (noise(p * 2.5 + 5.0) - 0.5);
  let age = fract((P.twist.z - atan2(p.z, p.x)) / TAU + ragged);
  if (age > P.heal.x) {
    next[i] = full;
    return;
  }
  // in the first lap the wear is on only where the front has already been, so it starts from a whole ring
  let passed = step(age, P.foam3.z);
  let wearing = passed * smoothstep(0.0, P.zone.x, age) * (1.0 - smoothstep(P.zone.y, P.zone.z, age));
  let healing = smoothstep(P.zone.w, P.zone.w + 0.03, age);
  if (d <= 0.0 && healing <= 0.0) {
    next[i] = d;
    return;
  }

  // the cells around: how much air touches this one, the fullest of them, and which way the rock lies
  var open = 0.0;
  var most = 0.0;
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
        most = max(most, v);
        into += w * v * vec3f(o);
      }
    }
  }
  open /= 14.6667;

  if (d > 0.0 && healing < 1.0) {
    let around = wideAt(vec3f(id)); // how much rock there is in the wider surroundings, 0 … 1
    let soft = pow(m.x, P.wear.y) + P.more.z;
    // tafoni: sheltered rock stays damp and weakens faster, so a pit deepens into a cave and its rim stays
    let shelter = 1.0 + P.wear.z * smoothstep(0.45, 0.8, around);
    // crumbs: rock with almost nothing around it, and threads one cell thin, go whatever they are made of
    let crumb = max(1.0 - smoothstep(0.02, 0.06, around), smoothstep(0.78, 0.9, open)) * (1.0 - healing);
    // faces turned into the wind wear faster
    var blown = 1.0;
    let len = length(into);
    if (len > 1e-4) {
      blown = max(1.0 + P.heal.w * dot(into / len, P.wind.xyz), 0.2);
    }
    // rock with no air near it wears only in the heart of a seed
    let air = max(open, P.heal.z * smoothstep(0.9, 1.0, m.x));
    // a piece that has come loose from the ring falls apart
    let loose = (1.0 - smoothstep(0.0, 0.01, heldAt(vec3f(id)))) * (1.0 - healing);
    let take = min(d, P.wear.x * (wearing * soft * shelter * blown + P.wear.w * crumb + P.foam2.z * loose) * air);
    d -= take;
    // a few of the cells that lost rock send out a grain of sand
    if (take > 0.008 && open > 0.1) {
      let dice = rand3(c + vec3i(i32(P.low.w) * 7, i32(P.low.w) * 13, 0));
      if (dice.x < take * P.foam2.w) {
        let slot = atomicAdd(&tally[1], 1u);
        if (slot < arrayLength(&born)) {
          born[slot] = vec4f(p + (dice - 0.5) * P.grid.w, take);
        }
      }
    }
  }
  // coming back, as the wear run backwards: the hardest rock first, then the cavities close towards their hearts.
  // Rock only comes back next to rock, so what was lost whole grows out again from what is left.
  if (healing > 0.0) {
    let on = (age - P.zone.w) / (P.heal.x - P.zone.w);
    let level = on * 1.3 - 0.15; // rock no softer than this is back
    let goal = full * (1.0 - smoothstep(level - 0.08, level + 0.08, m.x));
    if (goal > d) {
      d += min(goal - d, P.heal.y) * smoothstep(0.3, 0.6, most);
    }
  }
  next[i] = d;
}
