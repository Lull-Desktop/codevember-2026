// What a point of the labyrinth sees of the sun and of the sky, worked out from where the walls are and not
// from a shadow map: the walls are slabs on the lines of a grid, so a ray toward the sun only has to ask the
// few slots it passes over before it is above them all, and the sky a point has lost is the sum of what the
// nearest slabs cover of it.
//   pw, nw: place and normal in the world (x east, y up, -z north)
//   sun: xyz toward the sun (world), w how wide its edge is (tan of the half angle)
//   dim: cells east–west, cells along the walk, wall height, wall thickness
//   tim: x where on the sheet this moment is
// returns (sun 0..1, sky 0..1, sky over the open hemisphere, 0)
fn mzVis(pw: vec3f, nw: vec3f, sheet: texture_2d<f32>, smp: sampler, sun: vec4f, dim: vec4f, tim: vec4f) -> vec4f {
  let q = vec3f(pw.x, pw.y, -pw.z);
  let n = vec3f(nw.x, nw.y, -nw.z);
  let l = vec3f(sun.x, sun.y, -sun.z);
  var lit = 0.0;
  if (l.y > 0.0 && dot(n, l) > 0.0) {
    lit = mzSun(q + n * 0.02, l, sun.w, sheet, smp, dim, tim.x);
  }
  let sky = mzSky(q, n, sheet, smp, dim, tim.x);
  return vec4f(lit, sky.x, sky.y, 0.0);
}

// the two slots a cell owns: xy what part of its south one is filled (from, to: 0..1 along the slot), zw of its west one
fn mzCell(i: i32, j: i32, sheet: texture_2d<f32>, smp: sampler, dim: vec4f, u: f32) -> vec4f {
  let w = i32(dim.x);
  let h = i32(dim.y);
  let ii = ((i % w) + w) % w;
  let jj = ((j % h) + h) % h;
  let v = (f32(jj * w + ii) + 0.5) / f32(w * h);
  return textureSampleLevel(sheet, smp, vec2f(u, v), 0.0);
}

// how much of the sun a box leaves. Looked at along the ray, a box is a six-sided outline whose sides run along
// its three axes, so how far the ray passes from it is the largest of three plane distances; the shadow's edge
// is as soft as its caster is far. Only the part of the box ahead of the point counts.
fn mzBox(q: vec3f, l: vec3f, lo: vec3f, hi: vec3f, soft: f32, nx: vec3f, ny: vec3f, nz: vec3f) -> f32 {
  var a = lo;
  var b = hi;
  if (hi.y <= q.y) {
    return 1.0;
  }
  if (abs(l.z) >= abs(l.x)) {
    if (l.z > 0.0) {
      a.z = max(a.z, q.z);
    } else {
      b.z = min(b.z, q.z);
    }
  } else if (l.x > 0.0) {
    a.x = max(a.x, q.x);
  } else {
    b.x = min(b.x, q.x);
  }
  if (a.z >= b.z || a.x >= b.x) {
    return 1.0;
  }
  let c = (a + b) * 0.5 - q;
  let h = (b - a) * 0.5;
  let dx = abs(dot(nx, c)) - (abs(nx.y) * h.y + abs(nx.z) * h.z);
  let dy = abs(dot(ny, c)) - (abs(ny.x) * h.x + abs(ny.z) * h.z);
  let dz = abs(dot(nz, c)) - (abs(nz.x) * h.x + abs(nz.y) * h.y);
  // the top edge is as far as the ray climbs to it; an upright edge, as far as the box is along the ground
  let over = soft * (hi.y - q.y) / l.y + 0.004;
  let beside = soft * max(dot(c.xz, l.xz) / max(dot(l.xz, l.xz), 1e-4), 0.0) + 0.004;
  return smoothstep(-1.0, 1.0, max(dy / beside, max(dx, dz) / over));
}

fn mzSun(q: vec3f, l: vec3f, soft: f32, sheet: texture_2d<f32>, smp: sampler, dim: vec4f, u: f32) -> f32 {
  let th = dim.w * 0.5;
  let top = dim.z - 0.012;
  if (q.y >= top) {
    return 1.0;
  }
  let reach = (top - q.y) / l.y;
  let nx = normalize(cross(l, vec3f(1.0, 0.0, 0.0)));
  let ny = normalize(cross(l, vec3f(0.0, 1.0, 0.0)));
  let nz = normalize(cross(l, vec3f(0.0, 0.0, 1.0)));
  // the ground under the ray, from the point to where the ray is above every wall
  let e = q.xz + l.xz * reach;
  let pad = th + soft * reach + 0.01;
  let lo = min(q.xz, e) - pad;
  let hi = max(q.xz, e) + pad;
  var lit = 1.0;
  // walls on the lines z = j
  let j0 = i32(ceil(lo.y));
  for (var a = 0; a < 5; a++) {
    let j = j0 + a;
    if (f32(j) > hi.y || lit < 0.003) {
      break;
    }
    var s = 0.0;
    if (abs(l.z) > 1e-4) {
      s = clamp((f32(j) - q.z) / l.z, 0.0, reach);
    }
    let x = q.x + l.x * s;
    let i0 = i32(floor(x - pad));
    let i1 = i32(floor(x + pad));
    for (var i = i0; i <= i1; i++) {
      let c = mzCell(i, j, sheet, smp, dim, u).xy;
      if (c.y - c.x > 0.004) {
        lit *= mzBox(q, l, vec3f(f32(i) + c.x - th, -1.0, f32(j) - th), vec3f(f32(i) + c.y + th, top, f32(j) + th), soft, nx, ny, nz);
      }
    }
  }
  // walls on the lines x = i
  let i0 = i32(ceil(lo.x));
  for (var a = 0; a < 3; a++) {
    let i = i0 + a;
    if (f32(i) > hi.x || lit < 0.003) {
      break;
    }
    let ja = i32(floor(lo.y));
    for (var b = 0; b < 5; b++) {
      let j = ja + b;
      if (f32(j) > hi.y) {
        break;
      }
      let c = mzCell(i, j, sheet, smp, dim, u).zw;
      if (c.y - c.x > 0.004) {
        lit *= mzBox(q, l, vec3f(f32(i) - th, -1.0, f32(j) + c.x - th), vec3f(f32(i) + th, top, f32(j) + c.y + th), soft, nx, ny, nz);
      }
    }
  }
  return lit;
}

// the integral along one edge of a polygon on the unit sphere (Heitz's fit), so that a polygon's share of
// the hemisphere is the sum round its edges, dotted with the normal
fn mzSide(v1: vec3f, v2: vec3f) -> vec3f {
  let x = dot(v1, v2);
  let y = abs(x);
  let a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
  let b = 3.4175940 + (4.1616724 + y) * y;
  let v = a / b;
  var t = v;
  if (x <= 0.0) {
    t = 0.5 * inverseSqrt(max(1.0 - x * x, 1e-7)) - v;
  }
  return cross(v1, v2) * t;
}

fn mzQuad(a: vec3f, b: vec3f, c: vec3f, d: vec3f, n: vec3f) -> f32 {
  let p0 = normalize(a);
  let p1 = normalize(b);
  let p2 = normalize(c);
  let p3 = normalize(d);
  return abs(dot(mzSide(p0, p1) + mzSide(p1, p2) + mzSide(p2, p3) + mzSide(p3, p0), n));
}

// what a wall on the line z = line, from `begin` to `finish`, takes of the sky at q: a rectangle, cut to what is above
// the point and in front of its normal, fading out with distance (gone by 1.25 cells)
fn mzTake(q: vec3f, n: vec3f, line: f32, begin: f32, finish: f32, th: f32, top: f32) -> f32 {
  let y0 = max(q.y, 0.0);
  if (top <= y0 + 0.01) {
    return 0.0;
  }
  let zf = line - th * sign(line - q.z);
  if ((n.z > 0.5 && zf <= q.z + 0.001) || (n.z < -0.5 && zf >= q.z - 0.001)) {
    return 0.0;
  }
  var x0 = begin;
  var x1 = finish;
  if (n.x > 0.5) {
    x0 = max(x0, q.x);
  } else if (n.x < -0.5) {
    x1 = min(x1, q.x);
  }
  if (x1 <= x0 + 0.001) {
    return 0.0;
  }
  let dz = zf - q.z;
  let fade = 1.0 - smoothstep(0.75, 1.25, length(vec2f(clamp(q.x, x0, x1) - q.x, dz)));
  if (fade <= 0.0) {
    return 0.0;
  }
  let lo = y0 - q.y;
  let hi = top - q.y;
  return fade * mzQuad(vec3f(x0 - q.x, lo, dz), vec3f(x1 - q.x, lo, dz), vec3f(x1 - q.x, hi, dz), vec3f(x0 - q.x, hi, dz), n);
}

// how much sky is left: the three lines nearest the point each way, and four slots of each. A wall behind
// another on the same side counts for less.
fn mzSky(q: vec3f, n: vec3f, sheet: texture_2d<f32>, smp: sampler, dim: vec4f, u: f32) -> vec2f {
  let th = dim.w * 0.5;
  let top = dim.z;
  let ir = i32(floor(q.x + 0.5));
  let jr = i32(floor(q.z + 0.5));
  // the same point with x and z changed over, for the walls that run the other way
  let qt = q.zyx;
  let nt = n.zyx;
  var rows = array<f32, 3>(0.0, 0.0, 0.0);
  var cols = array<f32, 3>(0.0, 0.0, 0.0);
  for (var dj = -2; dj <= 1; dj++) {
    for (var di = -2; di <= 1; di++) {
      let fi = f32(ir + di);
      let fj = f32(jr + dj);
      // is anything this cell owns near enough to matter
      let south = dj >= -1 && length(vec2f(clamp(q.x, fi - th, fi + 1.0 + th) - q.x, max(abs(fj - q.z) - th, 0.0))) < 1.25;
      let west = di >= -1 && length(vec2f(max(abs(fi - q.x) - th, 0.0), clamp(q.z, fj - th, fj + 1.0 + th) - q.z)) < 1.25;
      if (!south && !west) {
        continue;
      }
      let c = mzCell(ir + di, jr + dj, sheet, smp, dim, u);
      if (south && c.y - c.x > 0.004) {
        rows[dj + 1] += mzTake(q, n, fj, fi + c.x - th, fi + c.y + th, th, top);
      }
      if (west && c.w - c.z > 0.004) {
        cols[di + 1] += mzTake(qt, nt, fi, fj + c.z - th, fj + c.w + th, th, top);
      }
    }
  }
  // the middle line of each three is the nearest; what stands beyond it on its side is partly hidden by it
  let full = 0.35;
  let hidR = 1.0 - min(rows[1] / full, 1.0);
  let hidC = 1.0 - min(cols[1] / full, 1.0);
  var lost = rows[1] + cols[1];
  if (q.z >= f32(jr)) {
    lost += rows[0] * hidR + rows[2];
  } else {
    lost += rows[0] + rows[2] * hidR;
  }
  if (q.x >= f32(ir)) {
    lost += cols[0] * hidC + cols[2];
  } else {
    lost += cols[0] + cols[2] * hidC;
  }
  let open = 0.5 + 0.5 * n.y;
  return vec2f(max(open - lost, 0.0), open);
}
