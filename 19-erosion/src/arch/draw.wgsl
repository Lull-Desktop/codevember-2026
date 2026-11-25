// The picture: the sky behind, the desert, the row of arches, and the sand in the air; and the map of what the light
// sees, for the shadows.

@group(0) @binding(2) var shadeMap: texture_depth_2d;
@group(0) @binding(3) var shadeLook: sampler_comparison;
@group(0) @binding(4) var<storage, read> grains: array<Grain>;
@group(0) @binding(5) var cloudMap: texture_2d<f32>;

// ---- sky

// the directions the sky's own frame is made of: the pole, east, and the equator due south
fn starFrame(d: vec3f) -> vec3f {
  let e = cross(F.mid.xyz, F.pole.xyz);
  return vec3f(dot(d, F.mid.xyz), dot(d, e), dot(d, F.pole.xyz));
}
// one scattering of stars, each drawn out along its way round the pole by as far as the sky turns while one looks
fn starsAt(th: f32, ph: f32, ring: f32, wide: f32, odds: f32, salt: i32, pix: f32) -> vec3f {
  let i = floor(th / ring);
  let n = max(floor(TAU * max(sin((i + 0.5) * ring), 0.002) / wide), 1.0);
  let trail = min(F.mid.w, 1.6 * TAU / n);
  let a = ph / TAU * n;
  var sum = vec3f(0.0);
  for (var k = -1; k <= 2; k++) {
    let j = floor(a) + f32(k);
    let jj = j - n * floor(j / n);
    let dice = rand3(vec3i(i32(i), i32(jj), salt));
    let more = rand3(vec3i(i32(jj), i32(i), salt + 7));
    if (more.x > odds) {
      continue;
    }
    let along = (j + dice.x - a) / n * TAU; // how far behind the star, round the pole
    let gap = max(max(-along, along - trail), 0.0) * sin(th);
    let off = th - (i + 0.2 + 0.6 * dice.y) * ring;
    let r = sqrt(gap * gap + off * off) / pix;
    let big = pow(dice.z, 9.0);
    let w = 0.75 + 0.9 * big;
    let bright = (0.12 + 2.6 * big) / (1.0 + 0.18 * trail * sin(th) / (pix * w));
    let hue = mix(vec3f(1.0, 0.82, 0.66), vec3f(0.72, 0.84, 1.0), more.y);
    sum += hue * bright * exp(-r * r / (w * w)) * mix(1.0, 0.25, clamp(along / max(trail, 1e-4), 0.0, 1.0));
  }
  return sum;
}
fn nightAt(d: vec3f) -> vec3f {
  let pix = 2.0 * F.up.w / F.size.y;
  let q = starFrame(d);
  let th = acos(clamp(q.z, -1.0, 1.0));
  let turn = atan2(q.y, q.x) - F.pole.w;
  let ph = turn - TAU * floor(turn / TAU);
  var col = starsAt(th, ph, 0.014, 0.13, 0.75, 3, pix);
  col += starsAt(th, ph, 0.007, 0.10, 0.6, 5, pix) * 0.35;
  // the milky way, a band across the sky with dark lanes in it
  let s = vec3f(sin(th) * cos(ph), sin(th) * sin(ph), cos(th));
  let lat = dot(s, normalize(vec3f(0.35, 0.75, 0.56)));
  let cloud = fbm(s * 4.5 + 3.0);
  let band = exp(-pow((lat + (cloud - 0.5) * 0.16) / 0.17, 2.0));
  let lane = smoothstep(0.42, 0.62, fbm(s * 9.0 + 20.0)) * exp(-pow(lat / 0.09, 2.0));
  col += vec3f(0.20, 0.21, 0.29) * band * (0.35 + 1.1 * cloud * cloud) * (1.0 - 0.75 * lane);
  return col * F.away.w * smoothstep(0.0, 0.22, d.y);
}

// flat-topped hills on the horizon: how high the land stands in a direction, as a slope
fn mesa(az: f32, k: f32) -> f32 {
  let x = az * (5.0 + 3.0 * k) + k * 17.3 + 3.0;
  let i = floor(x);
  let f = fract(x);
  let a = rand1(vec3i(i32(i), i32(k), 5));
  let b = rand1(vec3i(i32(i) + 1, i32(k), 5));
  // steep sides and level tops
  let top = mix(a, b, smoothstep(0.42, 0.58, f));
  let rough = noise(vec3f(az * 60.0, k * 3.0, 0.0)) * 0.12;
  return smoothstep(0.45, 0.6, top) * (0.6 + 0.4 * top) + rough * top;
}

// the far plain, half lost in haze
fn plainAt(d: vec3f) -> vec3f {
  let sand = lin(vec3f(0.89, 0.67, 0.50)) * F.land.w * (F.glare.rgb * max(F.light.y, 0.0) + F.high.rgb * 0.9);
  return mix(hazeAt(d), sand, 0.6);
}

fn skyAt(d: vec3f, cloud: vec4f) -> vec3f {
  let h = d.y / max(length(d.xz), 1e-4);
  var col = airAt(d);
  if (F.sun.w > 0.001) {
    col += nightAt(d) * F.sun.w;
  }
  // the sun and the moon themselves
  let s = dot(d, F.sun.xyz);
  col += F.sunTone.rgb * (smoothstep(0.99988, 0.99993, s) * 30.0 + 0.35 * pow(max(s, 0.0), 900.0)) * F.light.w;
  let m = dot(d, F.moon.xyz);
  let face = 0.75 + 0.35 * noise(d * 190.0);
  col += vec3f(0.95, 0.97, 1.0) * F.moon.w * (smoothstep(0.99972, 0.99978, m) * 2.2 * face + 0.10 * pow(max(m, 0.0), 1500.0));
  col = col * cloud.a + cloud.rgb;
  // the desert's edge: three rows of flat-topped hills, each nearer and less lost in haze
  let hazed = hazeAt(d);
  let az = atan2(d.z, d.x) + 0.35;
  let facing = 0.35 + 0.65 * max(dot(normalize(vec3f(-d.x, 0.0, -d.z)), F.light.xyz), 0.0);
  for (var k = 0.0; k < 3.0; k += 1.0) {
    let top = (0.062 - 0.030 * k) * mesa(az, k) - 0.008 * k;
    let land = lin(vec3f(0.66, 0.40, 0.31)) * (F.glare.rgb * facing * 0.45 + F.high.rgb * 0.6);
    let through = mix(hazed, land, 0.36 + 0.18 * k);
    col = mix(col, through, smoothstep(top + 0.0015, top - 0.0015, h));
  }
  return mix(col, plainAt(d), smoothstep(0.003, 0.0, h));
}

@vertex
fn skyVert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 1.0, 1.0);
}

@fragment
fn skyFrag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / F.size.xy;
  let s = uv * 2.0 - 1.0;
  let d = normalize(F.ahead.xyz + s.x * F.right.w * F.right.xyz - s.y * F.up.w * F.up.xyz);
  // the clouds were drawn small and dotted: the mean of a few places evens them out
  let px = 1.0 / vec2f(textureDimensions(cloudMap));
  var cloud = vec4f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      cloud += textureSampleLevel(cloudMap, airLook, clamp(uv + vec2f(f32(x), f32(y)) * px * 1.1, px * 0.5, 1.0 - px * 0.5), 0.0);
    }
  }
  return vec4f(skyAt(d, cloud / 9.0), 1.0);
}

// ---- light

// how much of the light reaches a point in the world; w is the point, far how far it is from the eye
fn litAt(w: vec3f, n: vec3f, far: f32) -> f32 {
  let cell = F.ahead.w;
  let q = F.shade * vec4f(w + n * cell * 1.6, 1.0);
  let uv = q.xy * vec2f(0.5, -0.5) + 0.5;
  let px = F.tone.z / vec2f(textureDimensions(shadeMap));
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(shadeMap, shadeLook, uv + vec2f(f32(x), f32(y)) * px, q.z - 0.0006);
    }
  }
  // the map does not reach far down the row; its edge is hidden by letting go of the shadows before it
  return mix(sum / 9.0, 1.0, smoothstep(17.0, 24.0, far));
}
// the sky's light on a face
fn skyLight(n: vec3f) -> vec3f {
  let side = normalize(vec3f(F.light.x, 0.0, F.light.z) + vec3f(1e-4, 0.0, 0.0));
  let a = dot(n, side) * 0.5 + 0.5;
  let level = mix(F.away.rgb, F.near.rgb, a);
  return mix(level * 0.8, F.high.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}
// and the ground's
fn groundLight() -> vec3f {
  return lin(vec3f(0.86, 0.60, 0.42)) * (F.glare.rgb * max(F.light.y, 0.0) + F.high.rgb * 0.7) * F.glare.w * F.land.w;
}
fn fogged(col: vec3f, w: vec3f) -> vec3f {
  let v = w - F.eye.xyz;
  let far = length(v);
  return mix(hazeAt(v / far), col, exp(-far * F.near.w));
}

// where the arch k steps down the row stands
fn stepOf(k: f32) -> vec3f {
  return vec3f(F.row.x * k, 0.0, -F.row.y * k);
}

// ---- rock

struct Rock {
  @builtin(position) at: vec4f,
  @location(0) own: vec3f,  // the place in the rock's space
  @location(1) nor: vec3f,
  @location(2) more: vec2f, // how open; depth below the first surface
  @location(3) wld: vec3f,
};

fn rockOut(a: vec4f, b: vec4f, k: f32) -> Rock {
  var o: Rock;
  o.wld = (F.turn * vec4f(a.xyz, 1.0)).xyz + stepOf(k);
  o.at = F.view * vec4f(o.wld, 1.0);
  o.own = a.xyz;
  o.nor = b.xyz;
  o.more = vec2f(a.w, b.w);
  return o;
}
@vertex
fn rockVert(@location(0) a: vec4f, @location(1) b: vec4f) -> Rock {
  return rockOut(a, b, 0.0);
}
// the arches further on, the furthest first
@vertex
fn farVert(@location(0) a: vec4f, @location(1) b: vec4f, @builtin(instance_index) i: u32) -> Rock {
  return rockOut(a, b, F.row.z - 1.0 - f32(i));
}
@vertex
fn shadeVert(@location(0) a: vec4f) -> @builtin(position) vec4f {
  return F.shade * (F.turn * vec4f(a.xyz, 1.0));
}
@vertex
fn shadeFarVert(@location(0) a: vec4f, @builtin(instance_index) i: u32) -> @builtin(position) vec4f {
  return F.shade * vec4f((F.turn * vec4f(a.xyz, 1.0)).xyz + stepOf(F.row.z - 1.0 - f32(i)), 1.0);
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


@fragment
fn rockFrag(i: Rock) -> @location(0) vec4f {
  let p = i.own;
  let s = layerAt(p);
  let hard = layerHard(s);
  var col = layerColour(s);
  let w = i.wld;
  let far = length(F.eye.xyz - w);
  // details too small to show at this distance are left out, or they would crawl
  let fine1 = 1.0 - smoothstep(6.0, 14.0, far);

  // fine lines inside a layer and the grain of the sand
  let fine = noise(vec3f(s * 9.0, p.x * 3.0, p.z * 3.0));
  let grain = noise(p * 260.0) * 0.6 + noise(p * 97.0) * 0.4;
  col *= 1.0 + F.size.w * (fine - 0.5) * 0.7;
  col *= 1.0 + F.size.z * (grain - 0.5) * fine1;
  // the first surface has a darker, redder skin; rock laid bare by the wear is fresher and paler
  let depth = select(i.more.y, -1.0 - i.more.y, i.more.y < -0.5);
  let bare = smoothstep(0.2, 2.5, depth / F.ahead.w);
  col = mix(col * mix(vec3f(1.0), vec3f(0.80, 0.68, 0.62), F.tone.x), col * vec3f(1.06, 1.0, 0.92), bare);

  // the normal, roughened: grains, and small steps where hard and soft layers meet. The first surface is smooth.
  var n = normalize(i.nor);
  let e = 0.0017;
  let bump = vec3f(
    noise((p + vec3f(e, 0.0, 0.0)) * 210.0) - noise((p - vec3f(e, 0.0, 0.0)) * 210.0),
    noise((p + vec3f(0.0, e, 0.0)) * 210.0) - noise((p - vec3f(0.0, e, 0.0)) * 210.0),
    noise((p + vec3f(0.0, 0.0, e)) * 210.0) - noise((p - vec3f(0.0, 0.0, e)) * 210.0));
  let ledge = layerHard(s + 0.06) - layerHard(s - 0.06);
  let worn = mix(0.25, 1.0, bare);
  n = normalize(n - F.size.z * 0.9 * bump * fine1 * worn - vec3f(0.0, 1.0, 0.0) * ledge * F.size.w * 1.5 * worn);

  let nw = normalize((F.turn * vec4f(n, 0.0)).xyz);
  let v = normalize(F.eye.xyz - w);
  let l = F.light.xyz;
  let open = mix(1.0, i.more.x, F.tone.y);

  let lit = litAt(w, nw, far);
  let facing = max(dot(nw, l), 0.0);
  var light = F.glare.rgb * facing * lit;
  light += skyLight(nw) * open;
  light += groundLight() * max(0.35 - 0.65 * nw.y, 0.0) * exp(-max(p.y, 0.0) * 0.5) * open;
  // light that has already bounced off the rock fills the hollows with its own colour
  light += col * F.glare.rgb * 0.12 * (1.0 - open) * (0.4 + 0.6 * lit);
  var shade = col * light;
  // the rim: grazing faces that the light is behind
  let graze = pow(1.0 - max(dot(nw, v), 0.0), 3.0);
  shade += F.glare.rgb * col * F.high.w * graze * smoothstep(-0.35, 0.5, dot(nw, l)) * (0.3 + 0.7 * lit) * open;
  // the first surface has a little polish
  let mid = normalize(l + v);
  shade += F.glare.rgb * 0.05 * pow(max(dot(nw, mid), 0.0), 30.0) * lit * facing * (1.0 - bare);

  shade = fogged(shade, w);
  let show = F.tone.w;
  if (show == 1.0) {
    shade = vec3f(open);
  } else if (show == 2.0) {
    shade = nw * 0.5 + 0.5;
  } else if (show == 3.0) {
    shade = vec3f(lit);
  } else if (show == 4.0) {
    shade = vec3f(hard);
  }
  // the last of the row comes out of nothing
  let a = 1.0 - smoothstep(F.row.y * (F.row.z - 2.0), F.row.y * (F.row.z - 1.2), far);
  return vec4f(shade, a);
}

// ---- ground

// noise on the ground that repeats with the row: k cells from one arch to the next
fn rowNoise(p: vec2f, k: f32, salt: i32) -> f32 {
  let q = vec2f(p.x + F.row.x / F.row.y * p.y, p.y) * k / F.row.y;
  let i = floor(q);
  let f = fract(q);
  let u = f * f * (3.0 - 2.0 * f);
  let y0 = i.y - k * floor(i.y / k);
  let y1 = (i.y + 1.0) - k * floor((i.y + 1.0) / k);
  let x = i32(i.x);
  return mix(
    mix(rand1(vec3i(x, i32(y0), salt)), rand1(vec3i(x + 1, i32(y0), salt)), u.x),
    mix(rand1(vec3i(x, i32(y1), salt)), rand1(vec3i(x + 1, i32(y1), salt)), u.x), u.y);
}
// where a place on the ground is from the arch nearest it, in that arch's own space; and which arch that is
fn nearArch(p: vec2f) -> vec3f {
  let k = round(-p.y / F.row.y);
  let o = vec3f(p.x - F.row.x * k, 0.0, p.y + F.row.y * k);
  let r = transpose(mat3x3f(F.turn[0].xyz, F.turn[1].xyz, F.turn[2].xyz)) * o;
  return vec3f(r.x, r.z, k);
}
fn groundAt(p: vec2f) -> f32 {
  let a = nearArch(p);
  let round1 = length(a.xy);
  let calm = smoothstep(1.2, 4.5, round1);
  var h = (rowNoise(p, 3.0, 41) - 0.35) * F.land.x * calm;
  h += (rowNoise(p, 8.0, 42) - 0.5) * F.land.x * 0.25 * mix(0.25, 1.0, calm);
  // sand banked against the feet: a little from the first, more as the rock comes down
  let legX = abs(a.x) - 0.5 * (P.arch.x + P.arch.y) - 0.5 * P.arch.w;
  let leg = length(vec2f(max(abs(legX) - 0.12, 0.0), max(abs(a.y) - 0.2, 0.0)));
  let pile = select(0.0, F.row.w, a.z == 0.0);
  h += (0.05 + 0.18 * pile) * exp(-leg * leg * 4.5 / (1.0 + 1.2 * pile)) * (0.7 + 0.6 * rowNoise(p, 34.0, 43));
  h += 0.07 * pile * exp(-(a.x * a.x * 0.7 + a.y * a.y * 2.2));
  return h;
}

struct Land {
  @builtin(position) at: vec4f,
  @location(0) wld: vec3f,
};
const COLS = 300u;
const ROWS = 130u; // from one arch to the next
// a net of squares over the desert: even along the row, so it looks the same one arch on; wider apart to the sides
@vertex
fn landVert(@builtin(vertex_index) v: u32) -> Land {
  let q = v / 6u;
  let k = v % 6u;
  let cx = q % COLS + u32(k == 1u || k == 2u || k == 4u);
  let cz = q / COLS + u32(k == 2u || k == 4u || k == 5u);
  let s = f32(cx) / f32(COLS) * 2.0 - 1.0;
  let z = F.row.y * (0.7 - f32(cz) / f32(ROWS));
  let x = s * 4.5 + 56.0 * pow(abs(s), 5.0) * s - F.row.x * z / F.row.y;
  var o: Land;
  o.wld = vec3f(x, groundAt(vec2f(x, z)), z);
  o.at = F.view * vec4f(o.wld, 1.0);
  return o;
}

@fragment
fn landFrag(i: Land) -> @location(0) vec4f {
  let w = i.wld;
  let p = w.xz;
  let v = F.eye.xyz - w;
  let far = length(v);
  let e = max(0.02, far * 0.004);
  let h = groundAt(p);
  var n = normalize(vec3f(h - groundAt(p + vec2f(e, 0.0)), e, h - groundAt(p + vec2f(0.0, e))));
  // ripples, creeping before the wind, drawn while they are wide enough to show
  let bent = rowNoise(p, 9.0, 51) * 2.6 + rowNoise(p, 24.0, 52) * 0.9;
  let q = vec2f(p.x + F.row.x / F.row.y * p.y, p.y / F.row.y);
  let wave = TAU * (q.x * 5.5 + q.y * 38.0 + bent - F.land.z);
  let seen = (1.0 - smoothstep(5.0, 13.0, far)) * F.land.y * (0.35 + 0.65 * rowNoise(p, 5.0, 53));
  n = normalize(n + vec3f(0.88, 0.0, 0.47) * cos(wave) * (0.6 + 0.4 * sin(wave)) * seen);
  // speckle, in the space of the nearest arch so that it repeats with the row
  let a = nearArch(p);
  let pa = a.xy;
  let g = vec3f(noise(vec3f(pa * 330.0, 1.0)), 0.5, noise(vec3f(pa * 330.0, 7.0))) - 0.5;
  n = normalize(n + g * 0.10 * (1.0 - smoothstep(1.0, 4.0, far)));

  let patchy = rowNoise(p, 6.0, 61) * 0.6 + rowNoise(p, 19.0, 62) * 0.4;
  var col = mix(lin(vec3f(0.84, 0.60, 0.43)), lin(vec3f(0.93, 0.75, 0.57)), patchy);
  col *= 0.95 + 0.10 * noise(vec3f(pa * 120.0, 3.0));
  // the foot of the arch keeps some of the sky off
  let rock = archDist(vec3f(a.x, 0.06, a.y));
  let open = mix(0.35, 1.0, smoothstep(-0.02, 0.45, rock)) * mix(0.8, 1.0, smoothstep(0.3, 1.6, length(a.xy)));
  let lit = litAt(w, vec3f(0.0, 1.0, 0.0), far);
  var light = F.glare.rgb * max(dot(n, F.light.xyz), 0.0) * lit + skyLight(n) * open;
  var shade = col * F.land.w * light;
  // sand against the light shines a little
  let mid = normalize(F.light.xyz + v / far);
  shade += F.glare.rgb * 0.04 * pow(max(dot(n, mid), 0.0), 12.0) * lit;
  shade = fogged(shade, w);
  // the desert ends in haze
  shade = mix(shade, plainAt(-v / far), smoothstep(F.row.y * 1.0, F.row.y * 4.3, far));
  return vec4f(shade, 1.0);
}

// ---- sand

struct Grain {
  at: vec4f,  // place in the world; seconds left
  vel: vec4f, // speed; seconds it had at the start
};

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
  let far = length(F.eye.xyz - g.at.xyz);
  // never smaller than about a pixel: then it is fainter instead
  let least = 0.9 * far * F.up.w / F.size.y;
  var dim = 1.0;
  if (size < least) {
    dim = size * size / (least * least);
    size = least;
  }
  // none right in front of the eye
  dim *= smoothstep(0.2, 1.0, far);
  if (g.at.w <= 0.0) {
    size = 0.0;
  }
  let w = g.at.xyz + (F.right.xyz * c.x + F.up.xyz * c.y) * size + g.vel.xyz * c.x * 0.003;
  var o: Mote;
  o.at = F.view * vec4f(w, 1.0);
  o.uv = c;
  // in the shadow of the rock a grain is lit by the sky alone
  let q = F.shade * vec4f(g.at.xyz, 1.0);
  let d2 = vec2f(textureDimensions(shadeMap));
  let px = vec2i(clamp((q.xy * vec2f(0.5, -0.5) + 0.5) * d2, vec2f(0.0), d2 - 1.0));
  let lit = step(q.z - 0.001, textureLoad(shadeMap, px, 0));
  // dust is brightest seen against the light
  let toEye = normalize(F.eye.xyz - g.at.xyz);
  let against = pow(max(dot(-toEye, F.light.xyz), 0.0), 3.0);
  let fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.5, 1.0, age));
  let col = lin(vec3f(1.0, 0.86, 0.66)) * (F.glare.rgb * lit * (0.35 + 2.5 * against) + F.high.rgb * 0.6);
  o.light = vec4f(col * F.sand.y, fade * (0.5 + 0.5 * dice.y) * dim);
  return o;
}

@fragment
fn sandFrag(i: Mote) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  let a = i.light.w * pow(max(1.0 - r, 0.0), 1.5);
  return vec4f(i.light.rgb * a, a * 0.2);
}
