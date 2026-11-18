// The picture on a ball, with no seam.
//
// A flat picture that repeats cannot be wrapped on a ball as it is: but the plane can be laid on a ball so that
// every small thing keeps its shape, only not its size (Mercator's map, the other way round). Going round the
// ball once is then a whole number of steps of the pattern, so it closes; going toward a pole the same picture
// comes again and again, smaller each time, without end. Sliding the picture up its own plane is, on the ball,
// a flow out of one pole and into the other.
struct Ball {
  screen: vec2f, // pixels
  radius: f32, // the ball's, pixels
  time: f32,
  turn: vec2f, // how the ball is turned to the eye: round its axis, and its axis toward the eye
  grain: f32,
  far: f32, // how far off the eye is, in radii
  round: vec2f, // once round the ball, in the picture's plane, over 2 pi (a step of the pattern, or a slanting one)
  centre: vec2f, // what of the picture is at the middle of the ball's front
  extent: vec2f, // the tile, in the picture's units
  pad: vec2f,
}
@group(0) @binding(0) var<uniform> B: Ball;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;

@vertex
fn vert(@builtin(vertex_index) n: u32) -> @builtin(position) vec4f {
  return vec4f(f32(n & 1u) * 4.0 - 1.0, f32(n >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}

// a point of the ball's surface, as the eye has it, in the ball's own axes (its axis is y)
fn own(n: vec3f) -> vec3f {
  let c = cos(B.turn);
  let s = sin(B.turn);
  let tipped = vec3f(n.x, c.y * n.y + s.y * n.z, -s.y * n.y + c.y * n.z);
  return vec3f(c.x * tipped.x - s.x * tipped.z, tipped.y, s.x * tipped.x + c.x * tipped.z);
}

// where on the picture's plane that is: round the ball, and Mercator's stretched way up it; then turned and scaled
fn plane(q: vec3f) -> vec2f {
  let w = vec2f(atan2(q.x, q.z), 0.5 * log((1.0 + q.y) / (1.0 - q.y)));
  return vec2f(w.x * B.round.x - w.y * B.round.y, w.x * B.round.y + w.y * B.round.x);
}
// and how that changes for a small step d over the ball (asked this way, and not of the plane itself, because
// the way round jumps back by a whole turn at the far side: the jump is not a change)
fn planeStep(q: vec3f, d: vec3f) -> vec2f {
  let w = vec2f((q.z * d.x - q.x * d.z) / max(q.x * q.x + q.z * q.z, 1e-9), d.y / max(1.0 - q.y * q.y, 1e-9));
  return vec2f(w.x * B.round.x - w.y * B.round.y, w.x * B.round.y + w.y * B.round.x);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let p = vec2f(at.x - 0.5 * B.screen.x, 0.5 * B.screen.y - at.y) / B.radius;
  let r = length(p);
  // the ground behind
  var back = mix(vec3f(0.83, 0.62, 0.57), vec3f(0.6, 0.4, 0.4), smoothstep(0.6, 2.6, r));
  // (and a little of the ball's shade on it, below)
  let under = (p - vec2f(0.0, -1.1)) * vec2f(1.0, 3.2);
  back *= 1.0 - 0.2 * exp(-dot(under, under));

  // the eye is `far` radii off; the ball's outline is at one radius on the screen
  let ro = vec3f(0.0, 0.0, B.far);
  let rd = normalize(vec3f(p * B.far / sqrt(B.far * B.far - 1.0), -B.far));
  let b = dot(ro, rd);
  let h = b * b - (B.far * B.far - 1.0);
  var tone = back;
  let n = ro + rd * (-b - sqrt(max(h, 0.0)));
  let nx = dpdx(n);
  let ny = dpdy(n);
  if (h > 0.0) {
    let q = own(n);
    let flip = vec2f(1.0, -1.0) / B.extent;
    let uv = (plane(q) + B.centre) * flip;
    var c = textureSampleGrad(picture, smooth_, uv, planeStep(q, own(nx)) * flip, planeStep(q, own(ny)) * flip).rgb;
    // the ball's own roundness: a little light from where the picture's sun is, a little dark toward the rim
    let lit = 0.74 + 0.36 * max(dot(n, normalize(vec3f(0.5, 0.65, 0.57))), 0.0) + 0.06 * n.z;
    c = pow(pow(c, vec3f(2.2)) * lit, vec3f(1.0 / 2.2));
    tone = mix(back, c, clamp((1.0 - r) * B.radius + 0.5, 0.0, 1.0));
  }
  let grain = fract(sin(dot(at.xy + B.time * 61.0, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(tone + grain * B.grain, 1.0);
}
