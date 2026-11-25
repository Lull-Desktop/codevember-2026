// What holds the rock up, worked out on a grid of half the fineness. The ground is the anchor; from it a number
// spreads through cells that have rock in them, losing a little with each cell. A piece that has come loose gets
// nothing from the ground any more: its number runs down to nothing, and the wear takes it.

@group(0) @binding(1) var<storage, read> rock: array<f32>;       // the smoothed rock, as it is meshed
@group(0) @binding(2) var<storage, read_write> lumps: array<f32>; // the part of each 2×2×2 cells that is rock
@group(0) @binding(3) var<storage, read> held: array<f32>;
@group(0) @binding(4) var<storage, read_write> holds: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn lump(@builtin(global_invocation_id) id: vec3u) {
  let m = (cells() + 1u) / 2u;
  if (any(id >= m)) {
    return;
  }
  var sum = 0.0;
  for (var k = 0; k < 8; k++) {
    // the smoothed field, so that what holds is just what is drawn: a film too thin to show holds nothing
    sum += step(0.5, rock[cellAt(vec3i(id) * 2 + vec3i(k & 1, (k >> 1) & 1, k >> 2))]);
  }
  lumps[id.x + m.x * (id.y + m.y * id.z)] = sum / 8.0;
}

// one round of the spreading: a cell takes the most of its six neighbours, less a little
@compute @workgroup_size(4, 4, 4)
fn hold(@builtin(global_invocation_id) id: vec3u) {
  let m = vec3i((cells() + 1u) / 2u);
  let c = vec3i(id);
  if (any(c >= m)) {
    return;
  }
  let i = c.x + m.x * (c.y + m.y * c.z);
  if (lumps[i] < 0.06) {
    holds[i] = 0.0;
    return;
  }
  var most = held[i];
  most = max(most, held[max(c.x - 1, 0) + m.x * (c.y + m.y * c.z)]);
  most = max(most, held[min(c.x + 1, m.x - 1) + m.x * (c.y + m.y * c.z)]);
  most = max(most, held[c.x + m.x * (max(c.y - 1, 0) + m.y * c.z)]);
  most = max(most, held[c.x + m.x * (min(c.y + 1, m.y - 1) + m.y * c.z)]);
  most = max(most, held[c.x + m.x * (c.y + m.y * max(c.z - 1, 0))]);
  most = max(most, held[c.x + m.x * (c.y + m.y * min(c.z + 1, m.z - 1))]);
  let p = place(vec3f(c) * 2.0 + 0.5);
  holds[i] = max(most - 1.0 / 1024.0, step(p.y, 0.03));
}
