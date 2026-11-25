// The sand that comes off the rock: each grain starts where a cell lost rock in this step, is taken by the wind
// and fades.

struct Grain {
  at: vec4f,  // place in the world; seconds left
  vel: vec4f, // speed; seconds it had at the start
};
@group(0) @binding(2) var<storage, read_write> grains: array<Grain>;
@group(0) @binding(3) var<storage, read> born: array<vec4f>; // places in the rock's space that lost rock; how much
@group(0) @binding(4) var<storage, read> tally: array<u32, 4>;

// a field that swirls: three unrelated noises, slowly drifting
fn swirl(p: vec3f, t: f32) -> vec3f {
  let q = p * 1.6 + vec3f(0.0, t * 0.25, t * 0.1);
  return vec3f(noise(q + 11.0), noise(q + 37.0), noise(q + 71.0)) - 0.5;
}

@compute @workgroup_size(64)
fn drift(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&grains)) {
    return;
  }
  var g = grains[i];
  let dt = 1.0 / 60.0;
  let t = F.eye.w;
  if (g.at.w <= 0.0) {
    // a grain at rest takes a place from the list at random; the fuller the list, the more of them start
    let dice = rand3(vec3i(i32(i), i32(round(t * 60.0)), 3));
    let slot = u32(dice.x * f32(arrayLength(&born)));
    if (slot >= min(tally[1], arrayLength(&born))) {
      return;
    }
    // few places are reported in a step and many grains start from each, so they are scattered round it and only
    // some of them go, or they would come off in clots
    let more = rand3(vec3i(i32(i), i32(round(t * 60.0)), 5));
    if (more.x > F.sand.w) {
      return;
    }
    let start = (F.turn * vec4f(born[slot].xyz, 1.0)).xyz + (more.yzx - 0.5) * vec3f(0.07, 0.07, 0.07);
    let life = mix(1.0, 4.5, dice.y * dice.y);
    g.at = vec4f(start, life);
    g.vel = vec4f((rand3(vec3i(i32(i), i32(round(t * 60.0)), 9)) - 0.5) * 0.3, life);
  }
  let age = 1.0 - g.at.w / g.vel.w;
  // a grain hangs and falls for a moment, then the wind has it
  let taken = smoothstep(0.0, 0.35, age);
  let gust = 0.75 + 0.5 * rand1(vec3i(i32(i), 4, 8));
  let want = F.wind.xyz * F.wind.w * gust * (0.25 + 0.75 * taken) + swirl(g.at.xyz, t) * F.sand.z;
  var v = g.vel.xyz;
  v += (want - v) * min(2.5 * dt, 1.0);
  // some grains are heavier than others
  let heavy = rand1(vec3i(i32(i), 2, 8));
  v.y -= (0.2 + 1.6 * heavy * heavy) * (1.0 - 0.6 * taken) * dt;
  var at = g.at.xyz + v * dt;
  // what comes down on the ground stays low and runs along it
  if (at.y < 0.02) {
    at.y = 0.02;
    v.y = max(v.y, 0.0);
    g.at.w -= 4.0 * dt;
  }
  g.at = vec4f(at, g.at.w - dt);
  g.vel = vec4f(v, g.vel.w);
  grains[i] = g;
}
