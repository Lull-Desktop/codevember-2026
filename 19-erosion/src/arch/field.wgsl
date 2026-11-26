// Fields made from the rock after each step: the coarse one (how much rock is around) and the smoothed one that
// is meshed.

@group(0) @binding(1) var<storage, read> rock: array<f32>;
@group(0) @binding(2) var<storage, read_write> rough: array<f32>;

// every coarse cell: the mean of its 4×4×4 cells
@compute @workgroup_size(4, 4, 4)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  let m = (cells() + 3u) / 4u;
  if (any(id >= m)) {
    return;
  }
  var sum = 0.0;
  for (var z = 0; z < 4; z++) {
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        sum += rock[cellAt(vec3i(id) * 4 + vec3i(x, y, z))];
      }
    }
  }
  rough[id.x + m.x * (id.y + m.y * id.z)] = sum / 64.0;
}

@group(0) @binding(3) var<storage, read> coarse: array<f32>;
@group(0) @binding(4) var<storage, read_write> wider: array<f32>;

// the coarse field blurred over its neighbours
@compute @workgroup_size(4, 4, 4)
fn blur(@builtin(global_invocation_id) id: vec3u) {
  let m = vec3i((cells() + 3u) / 4u);
  let c = vec3i(id);
  if (any(c >= m)) {
    return;
  }
  var sum = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let k = clamp(c + vec3i(x, y, z), vec3i(0), m - 1);
        let w = f32((2 - abs(x)) * (2 - abs(y)) * (2 - abs(z)));
        sum += w * coarse[k.x + m.x * (k.y + m.y * k.z)];
      }
    }
  }
  wider[c.x + m.x * (c.y + m.y * c.z)] = sum / 64.0;
}

@group(0) @binding(5) var<storage, read> sharp: array<f32>;
@group(0) @binding(6) var<storage, read_write> smoothed: array<f32>;

// the field that is meshed: the rock blended with its neighbours, which rounds off the steps of single cells
@compute @workgroup_size(4, 4, 4)
fn soften(@builtin(global_invocation_id) id: vec3u) {
  let n = cells();
  if (any(id >= n)) {
    return;
  }
  let c = vec3i(id);
  let i = id.x + n.x * (id.y + n.y * id.z);
  let d = sharp[i];
  var sum = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let w = f32((2 - abs(x)) * (2 - abs(y)) * (2 - abs(z)));
        sum += w * sharp[cellAt(c + vec3i(x, y, z))];
      }
    }
  }
  smoothed[i] = mix(d, sum / 64.0, P.more.y);
}
