// The picture: the sky behind, the meshed rock lit by a low sun, and the map of what the sun sees for the shadows.

@group(0) @binding(2) var shadeMap: texture_depth_2d;
@group(0) @binding(3) var shadeLook: sampler_comparison;

fn lin(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

// ---- sky

const SUNSET = vec3f(1.0, 0.68, 0.42);

// flat-topped hills on the horizon: how high the land stands in a direction, as a slope
fn mesa(az: f32, k: f32) -> f32 {
  let x = az * (5.0 + 3.0 * k) + k * 17.3;
  let i = floor(x);
  let f = fract(x);
  let a = rand1(vec3i(i32(i), i32(k), 5));
  let b = rand1(vec3i(i32(i) + 1, i32(k), 5));
  // steep sides and level tops
  let top = mix(a, b, smoothstep(0.42, 0.58, f));
  let rough = noise(vec3f(az * 60.0, k * 3.0, 0.0)) * 0.12;
  return smoothstep(0.45, 0.6, top) * (0.6 + 0.4 * top) + rough * top;
}

fn skyAt(d: vec3f) -> vec3f {
  let h = d.y / max(length(d.xz), 1e-4);
  let zenith = lin(vec3f(0.34, 0.42, 0.62));
  let middle = lin(vec3f(0.80, 0.62, 0.64));
  let low = lin(vec3f(1.0, 0.76, 0.54));
  var col = mix(low, middle, smoothstep(0.0, 0.2, h));
  col = mix(col, zenith, smoothstep(0.08, 0.6, h));
  // the glow round the sun
  let c = max(dot(normalize(d), F.sun.xyz), 0.0);
  let glow = SUNSET * (0.3 * pow(c, 5.0) + 1.0 * pow(c, 40.0));
  col += glow + SUNSET * 40.0 * pow(c, 2500.0);
  // thin high cloud, lit from below
  let over = vec3f(d.x, d.z, 0.0) / max(d.y + 0.3, 0.05);
  let streak = fbm(over * vec3f(0.35, 1.5, 1.0) + 3.0) * 0.7 + fbm(over * vec3f(1.1, 4.0, 1.0) + 9.0) * 0.3;
  col = mix(col, low * 0.9 + middle * 0.25 + glow, smoothstep(0.48, 0.72, streak) * smoothstep(0.02, 0.25, h) * 0.55);
  // the desert: three rows of flat-topped hills, each nearer and less lost in haze, then the plain
  let hazed = low * (0.95 + 0.5 * pow(c, 5.0)) + glow * 0.6;
  let az = atan2(d.z, d.x);
  for (var k = 0.0; k < 3.0; k += 1.0) {
    let top = (0.05 - 0.028 * k) * mesa(az, k) - 0.018 * k;
    let land = lin(vec3f(0.60, 0.36, 0.28)) * (0.55 + 0.6 * pow(c, 3.0));
    let through = mix(hazed, land, 0.22 + 0.2 * k);
    col = mix(col, through, smoothstep(top + 0.002, top - 0.002, h));
  }
  if (h < -0.04) {
    let ground = lin(vec3f(0.70, 0.44, 0.30)) * (0.5 + 0.7 * pow(c, 3.0));
    col = mix(col, ground, (1.0 - exp((h + 0.04) * 7.0)) * 0.8);
  }
  return col * F.sky.x;
}

@vertex
fn skyVert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 1.0, 1.0);
}

@fragment
fn skyFrag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / F.size.xy) * 2.0 - 1.0;
  let d = normalize(F.ahead.xyz + uv.x * F.right.w * F.right.xyz - uv.y * F.up.w * F.up.xyz);
  return vec4f(skyAt(d), 1.0);
}

// ---- rock

struct Rock {
  @builtin(position) at: vec4f,
  @location(0) own: vec3f,  // the place in the rock's space
  @location(1) nor: vec3f,
  @location(2) more: vec2f, // how open; depth below the first surface
};

@vertex
fn rockVert(@location(0) a: vec4f, @location(1) b: vec4f) -> Rock {
  var o: Rock;
  o.at = F.view * (F.model * vec4f(a.xyz, 1.0));
  o.own = a.xyz;
  o.nor = b.xyz;
  o.more = vec2f(a.w, b.w);
  return o;
}

@vertex
fn shadeVert(@location(0) a: vec4f) -> @builtin(position) vec4f {
  return F.shade * (F.model * vec4f(a.xyz, 1.0));
}

// the colour of a layer: cream, orange and red beds, with thin pale and dark seams
fn layerColour(s: f32) -> vec3f {
  let cream = lin(vec3f(0.94, 0.82, 0.66));
  let peach = lin(vec3f(0.90, 0.64, 0.46));
  let orange = lin(vec3f(0.80, 0.46, 0.28));
  let red = lin(vec3f(0.62, 0.27, 0.22));
  let pale = lin(vec3f(0.97, 0.91, 0.80));
  let a = layerRand(s, 3);
  let b = layerRand(s * 0.23 + 5.3, 4);
  let e = layerRand(s * 2.7, 5);
  let g = layerRand(s * 0.61 + 2.1, 6);
  var col = mix(peach, cream, smoothstep(0.3, 0.7, a));
  col = mix(col, orange, 0.8 * smoothstep(0.45, 0.75, g));
  col = mix(col, red, 0.9 * smoothstep(0.5, 0.75, b) * (0.5 + 0.5 * a));
  col = mix(col, pale, 0.75 * smoothstep(0.78, 0.92, e));
  col = mix(col, red * 0.55, 0.7 * smoothstep(0.14, 0.04, e));
  return col;
}

// how much of the sun reaches a point in the world
fn sunlit(w: vec3f, n: vec3f) -> f32 {
  let cell = F.ahead.w;
  let q = F.shade * vec4f(w + n * cell * 1.5, 1.0);
  let uv = q.xy * vec2f(0.5, -0.5) + 0.5;
  let px = F.tone.z / vec2f(textureDimensions(shadeMap));
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(shadeMap, shadeLook, uv + vec2f(f32(x), f32(y)) * px, q.z - 0.0015);
    }
  }
  return sum / 9.0;
}

@fragment
fn rockFrag(i: Rock) -> @location(0) vec4f {
  let p = i.own;
  let s = layerAt(p);
  let hard = layerHard(s);
  var col = layerColour(s);

  // fine lines inside a layer and the grain of the sand
  let fine = noise(vec3f(s * 9.0, p.x * 3.0, p.z * 3.0));
  let grain = noise(p * 260.0) * 0.6 + noise(p * 97.0) * 0.4;
  col *= 1.0 + F.size.w * (fine - 0.5) * 0.7;
  col *= 1.0 + F.size.z * (grain - 0.5);
  // the first surface has a darker, redder skin; rock laid bare by the wear is fresher and paler
  let loose = i.more.y < -0.5;
  let depth = select(i.more.y, -1.0 - i.more.y, loose);
  let bare = smoothstep(0.2, 2.5, depth / F.ahead.w);
  col = mix(col * mix(vec3f(1.0), vec3f(0.78, 0.66, 0.6), F.tone.x), col * vec3f(1.06, 1.0, 0.92), bare);

  // the normal, roughened: grains, and small steps where hard and soft layers meet
  var n = normalize(i.nor);
  let e = 0.0017;
  let bump = vec3f(
    noise((p + vec3f(e, 0.0, 0.0)) * 210.0) - noise((p - vec3f(e, 0.0, 0.0)) * 210.0),
    noise((p + vec3f(0.0, e, 0.0)) * 210.0) - noise((p - vec3f(0.0, e, 0.0)) * 210.0),
    noise((p + vec3f(0.0, 0.0, e)) * 210.0) - noise((p - vec3f(0.0, 0.0, e)) * 210.0));
  let ledge = layerHard(s + 0.06) - layerHard(s - 0.06);
  n = normalize(n - F.size.z * 0.9 * bump - vec3f(0.0, 1.0, 0.0) * ledge * F.size.w * 1.5);

  let nw = normalize((F.model * vec4f(n, 0.0)).xyz);
  let w = (F.model * vec4f(p, 1.0)).xyz;
  let v = normalize(F.eye.xyz - w);
  let l = F.sun.xyz;
  let open = mix(1.0, i.more.x, F.tone.y);

  let lit = sunlit(w, nw);
  let facing = max(dot(nw, l), 0.0);
  let sunCol = SUNSET * F.sun.w;
  var light = sunCol * facing * lit;
  // the sky from above, the warm ground from below
  let above = mix(lin(vec3f(0.86, 0.50, 0.30)) * 0.55, lin(vec3f(0.62, 0.62, 0.86)), nw.y * 0.5 + 0.5);
  light += above * F.sky.x * open;
  // light that has already bounced off the rock fills the hollows with its own colour
  light += col * SUNSET * F.sky.w * (1.0 - open) * (0.4 + 0.6 * lit);
  var shade = col * light;
  // the rim: grazing faces that the sun is behind
  let graze = pow(1.0 - max(dot(nw, v), 0.0), 3.0);
  shade += sunCol * col * F.sky.z * graze * smoothstep(-0.35, 0.5, dot(nw, l)) * (0.3 + 0.7 * lit) * open;

  // haze between the eye and the rock
  let far = length(F.eye.xyz - w);
  shade = mix(shade, lin(vec3f(1.0, 0.76, 0.54)) * F.sky.x, 1.0 - exp(-far * F.sky.y));

  let show = F.tone.w;
  if (show == 1.0) {
    shade = vec3f(open);
  } else if (show == 2.0) {
    shade = nw * 0.5 + 0.5;
  } else if (show == 3.0) {
    shade = vec3f(lit);
  } else if (show == 4.0) {
    shade = vec3f(hard);
  } else if (show == 5.0 && loose) {
    shade = vec3f(0.0, 0.6, 1.0);
  }
  return vec4f(shade, 1.0);
}

// ---- sand

struct Grain {
  at: vec4f,  // place in the world; seconds left
  vel: vec4f, // speed; seconds it had at the start
};
@group(0) @binding(4) var<storage, read> grains: array<Grain>;

struct Mote {
  @builtin(position) at: vec4f,
  @location(0) uv: vec2f,
  @location(1) light: vec4f,
};

// each grain is a small square turned to the eye, pulled out a little along its flight
@vertex
fn sandVert(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Mote {
  const QUAD = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let g = grains[i];
  let c = QUAD[v];
  let dice = rand3(vec3i(i32(i), 7, 1));
  let age = 1.0 - g.at.w / max(g.vel.w, 0.01);
  var size = F.sand.x * (0.4 + 1.2 * dice.x * dice.x);
  if (g.at.w <= 0.0) {
    size = 0.0;
  }
  let w = g.at.xyz + (F.right.xyz * c.x + F.up.xyz * c.y) * size + g.vel.xyz * c.x * 0.003;
  var o: Mote;
  o.at = F.view * vec4f(w, 1.0);
  o.uv = c;
  // in the shadow of the rock a grain is lit by the sky alone
  let q = F.shade * vec4f(g.at.xyz, 1.0);
  let dim = vec2f(textureDimensions(shadeMap));
  let px = vec2i(clamp((q.xy * vec2f(0.5, -0.5) + 0.5) * dim, vec2f(0.0), dim - 1.0));
  let lit = step(q.z - 0.003, textureLoad(shadeMap, px, 0));
  // dust is brightest seen against the sun
  let toEye = normalize(F.eye.xyz - g.at.xyz);
  let against = pow(max(dot(-toEye, F.sun.xyz), 0.0), 3.0);
  let fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.5, 1.0, age));
  let col = lin(vec3f(1.0, 0.86, 0.66)) * (SUNSET * F.sun.w * lit * (0.35 + 2.5 * against) + lin(vec3f(0.7, 0.62, 0.7)) * F.sky.x * 0.6);
  o.light = vec4f(col * F.sand.y, fade * (0.5 + 0.5 * dice.y));
  return o;
}

@fragment
fn sandFrag(i: Mote) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let a = i.light.w * pow(max(1.0 - r, 0.0), 1.5);
  return vec4f(i.light.rgb * a, a * 0.7);
}
