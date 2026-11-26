// The clouds: a slab of them over the desert, marched through at half the picture's fineness. The noise they are
// made of repeats, so they can race for as long as they like and come back to where they were.

@group(0) @binding(2) var puff: texture_3d<f32>;
@group(0) @binding(3) var puffLook: sampler;

const BASE = 1.0;
const THICK = 0.42;

// how thick the cloud is at a point; h is how high in the slab it is, 0 … 1
fn cloudAt(p: vec3f, h: f32, fine: bool) -> f32 {
  let tile = F.cloud.z;
  let a = textureSampleLevel(puff, puffLook, vec3f(p.x / tile + F.drift.x, p.y * 0.35, p.z / tile + F.drift.y), 0.0);
  // a wider noise says where there are clouds at all
  let wide = textureSampleLevel(puff, puffLook, vec3f(p.x / (tile * 3.0) + F.drift.x / 3.0, 0.37, p.z / (tile * 3.0) + F.drift.y / 3.0), 0.0).b;
  let shape = smoothstep(0.0, 0.18, h) * smoothstep(1.0, 0.3, h);
  let cover = F.cloud.x + (wide - 0.5) * 0.9;
  var d = a.r * shape - (1.0 - cover);
  if (d <= 0.0) {
    return 0.0;
  }
  if (fine) {
    let b = textureSampleLevel(puff, puffLook, vec3f(p.x / (tile * 0.27) + F.drift.z, p.y * 1.3 + F.cloud.w, p.z / (tile * 0.27) + F.drift.w), 0.0).g;
    d -= b * 0.42 * (1.0 - smoothstep(0.0, 0.4, d));
  }
  return max(d, 0.0) * F.cloud.y;
}
fn henyey(m: f32, g: f32) -> f32 {
  return 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * m, 1.5);
}

@vertex
fn vert(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn frag(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / vec2f(floor(F.size.xy * 0.5))) * 2.0 - 1.0;
  let d = normalize(F.ahead.xyz + uv.x * F.right.w * F.right.xyz - uv.y * F.up.w * F.up.xyz);
  if (d.y < 0.005) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  // the slab bends down with the earth, so it comes to the horizon at some distance
  let bend = 0.055;
  let t0 = BASE / (d.y + bend);
  let t1 = (BASE + THICK) / (d.y + bend);
  let n = 22;
  let dt = (t1 - t0) / f32(n);
  let jit = fract(52.9829189 * fract(dot(floor(at.xy), vec2f(0.06711056, 0.00583715))));
  let l = F.light.xyz;
  let m = dot(d, l);
  let phase = mix(henyey(m, 0.75), henyey(m, -0.15), 0.45) * 4.0 + 0.25;
  let low = hazeAt(d);
  var through = 1.0;
  var sum = vec3f(0.0);
  for (var i = 0; i < n; i++) {
    let t = t0 + (f32(i) + jit) * dt;
    let p = d * t;
    let h = (t - t0) / (t1 - t0);
    let k = cloudAt(p, h, true);
    if (k <= 0.0) {
      continue;
    }
    // towards the light, to see how much cloud is in the way
    var over = 0.0;
    for (var j = 0; j < 4; j++) {
      let s = 0.05 * pow(1.9, f32(j));
      let hh = h + l.y * s / THICK;
      if (hh < 1.0 && hh > 0.0) {
        over += cloudAt(p + l * s, hh, false) * s;
      }
    }
    let dim = exp(-over * 5.0) * 0.8 + exp(-over * 1.2) * 0.2;
    let sky = mix(low * 0.75, F.high.rgb * 1.1, h) * (0.55 + 0.45 * h);
    let lit = F.sunTone.rgb * phase * dim + sky;
    let a = 1.0 - exp(-k * dt * 9.0);
    sum += through * a * lit;
    through *= 1.0 - a;
    if (through < 0.01) {
      break;
    }
  }
  // far clouds go into the haze
  let gone = exp(-t0 * 0.10);
  let solid = (1.0 - through) * smoothstep(0.005, 0.06, d.y);
  sum = mix(low * (1.0 - through), sum, gone) * smoothstep(0.005, 0.06, d.y);
  return vec4f(sum, 1.0 - solid);
}
