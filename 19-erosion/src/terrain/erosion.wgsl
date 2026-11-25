// The erosion filter: gullies and ridges that branch downhill, made of noise alone, with nothing simulated.
//
// phacelle() and erosionFilter() below are a port to WGSL of Rune Skovbo Johansen's "Advanced Terrain Erosion
// Filter" (https://www.shadertoy.com/view/wXcfWn, explained at
// https://blog.runevision.com/2026/03/fast-and-gorgeous-erosion-filter.html), which grew out of Clay John's
// "Eroded Terrain Noise" and Fewes' "Terrain Erosion Noise". The Shadertoy page itself would not load from a
// script, so the port was made from Luke Mitchell's line-by-line C# conversion of it
// (https://github.com/lpmitchell/AdvancedTerrainErosion); the names and comments follow that.
//
// Phacelle Noise and Advanced Terrain Erosion Filter copyright (c) 2025 Rune Skovbo Johansen.
// Converted to C# by Luke Mitchell, 2026; to WGSL here.
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// hash2() and noised() are Inigo Quilez's (https://www.shadertoy.com/view/XdXBRH, MIT licence).

const TAU = 6.28318530718;

fn hash2(at: vec2f) -> vec2f {
  let k = vec2f(0.3183099, 0.3678794);
  let x = at * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

// gradient noise (in x) and its derivatives (in yz)
fn noised(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = hash2(i + vec2f(0.0, 0.0));
  let gb = hash2(i + vec2f(1.0, 0.0));
  let gc = hash2(i + vec2f(0.0, 1.0));
  let gd = hash2(i + vec2f(1.0, 1.0));
  let va = dot(ga, f - vec2f(0.0, 0.0));
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  return vec3f(
    va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * (va - vb - vc + vd) + vec2f(vb, vc) - va),
  );
}

fn powInv(t: f32, power: f32) -> f32 {
  return 1.0 - pow(1.0 - clamp(t, 0.0, 1.0), power);
}
fn easeOut(t: f32) -> f32 {
  let v = 1.0 - clamp(t, 0.0, 1.0);
  return 1.0 - v * v;
}
fn smoothStart(t: f32, smoothing: f32) -> f32 {
  if (t >= smoothing) {
    return t - 0.5 * smoothing;
  }
  return 0.5 * t * t / max(smoothing, 1e-6);
}
fn normalizeSafe(v: vec2f) -> vec2f {
  let l = length(v);
  if (l < 1e-9) {
    return vec2f(0.0);
  }
  return v / l;
}

// Phacelle noise: stripes that run along normDir. Each cell of a grid has its own cosine and sine wave, turned
// to the direction asked for; the waves of the 4x4 cells around the point are blended, and the blend is
// brought back to full strength. xy: the cosine and sine of the phase; zw: the direction across the stripes,
// times their frequency (multiply it onto the sine for the cosine's slope).
// freq: stripes per cell (keep near 1); offset: phase, 1 a full cycle; normalization: 0..1, how much of the
// blend's lost strength is given back.
fn phacelle(p: vec2f, normDir: vec2f, freq: f32, offset: f32, normalization: f32, seed: vec2f) -> vec4f {
  let sideDir = normDir.yx * vec2f(-1.0, 1.0) * freq * TAU;
  let off = offset * TAU;
  let pInt = floor(p);
  let pFrac = fract(p);
  var phaseDir = vec2f(0.0);
  var weightSum = 0.0;
  for (var i = -1; i <= 2; i++) {
    for (var j = -1; j <= 2; j++) {
      let gridOffset = vec2f(f32(i), f32(j));
      // the cell's point: a grid point moved at random by up to half a cell each way
      let randomOffset = hash2(pInt + gridOffset + seed) * 0.5;
      let fromCell = pFrac - gridOffset - randomOffset;
      // bell-shaped weight: 1 at the cell's point and (with the bit taken off) 0 at 1.5 away, which is as
      // near as a point outside the 4x4 cells can be
      let sqrDist = dot(fromCell, fromCell);
      let weight = max(0.0, exp(-sqrDist * 2.0) - 0.01111);
      weightSum += weight;
      let waveInput = dot(fromCell, sideDir) + off;
      phaseDir += vec2f(cos(waveInput), sin(waveInput)) * weight;
    }
  }
  let interpolated = phaseDir / weightSum;
  // only blends weaker than this are left short of full strength, where two cells disagree outright
  let magnitude = max(1.0 - normalization, length(interpolated));
  return vec4f(interpolated / magnitude, sideDir);
}

struct Eroded {
  delta: vec3f, // what the gullies add: to the height (x) and to its slope (yz)
  magnitude: f32, // the most they could have added
  ridges: f32, // -1 in the creases, 1 on the ridges, 0 where there are no gullies
};

// p: the point; heightAndSlope: the smooth land to be worn, and its slope; fadeTargetIn: -1 in the valleys
// and 1 on the peaks of that land (the gullies fade to it where the ground is flat).
// strength, gullyWeight, detail, rounding, onset, assumedSlope: the look (see index.ts for what each does).
// scale: the width of the largest gullies; lacunarity, gain: how much finer and weaker each octave is.
fn erosionFilter(
  p: vec2f,
  heightAndSlopeIn: vec3f,
  fadeTargetIn: f32,
  strengthIn: f32,
  gullyWeight: f32,
  detail: f32,
  rounding: vec4f,
  onset: vec4f,
  assumedSlope: vec2f,
  scale: f32,
  octaves: i32,
  lacunarity: f32,
  gain: f32,
  cellScale: f32,
  normalization: f32,
  seed: vec2f,
) -> Eroded {
  var strength = strengthIn * scale;
  var fadeTarget = clamp(fadeTargetIn, -1.0, 1.0);
  var heightAndSlope = heightAndSlopeIn;
  var freq = 1.0 / (scale * cellScale);
  let slopeLength = max(length(heightAndSlope.yz), 1e-10);
  var magnitude = 0.0;
  var roundingMult = 1.0;

  let roundingForInput = mix(rounding.y, rounding.x, clamp(fadeTarget + 0.5, 0.0, 1.0)) * rounding.z;
  // the mask that gathers: first from the land's own slope, then from each octave's slope too
  var combiMask = easeOut(smoothStart(slopeLength * onset.x, roundingForInput * onset.x));

  // the ridge map keeps a fade target and a mask of its own
  var ridgeMapCombiMask = easeOut(slopeLength * onset.z);
  var ridgeMapFadeTarget = fadeTarget;

  // the slope the first gullies run down: the real one, or its direction with an assumed steepness
  var gullySlope = mix(heightAndSlope.yz, heightAndSlope.yz / slopeLength * assumedSlope.x, assumedSlope.y);

  for (var i = 0; i < octaves; i++) {
    var ph = phacelle(p * freq, normalizeSafe(gullySlope), cellScale, 0.25, normalization, seed);
    // times freq since p was; negated since the slope directions point downhill
    ph = vec4f(ph.xy, ph.zw * -freq);
    // how much it slopes here, 0 to 1
    let sloping = abs(ph.y);

    // The unmasked slope, at the wave's steepest everywhere, goes to the octaves after this one, so that
    // their gullies run straight down the sides of these.
    gullySlope += sign(ph.y) * ph.zw * strength * gullyWeight;

    // the gullies: height (-1 to 1) in x and slope in yz
    let gullies = vec3f(ph.x, ph.y * ph.zw);
    // faded toward the fade target by the mask
    let fadedGullies = mix(vec3f(fadeTarget, 0.0, 0.0), gullies * gullyWeight, combiMask);
    heightAndSlope += fadedGullies * strength;
    magnitude += strength;

    // this octave is the next one's fade target
    fadeTarget = fadedGullies.x;

    // and is added to the mask: nothing finer on its ridges and in its creases
    let roundingForOctave = mix(rounding.y, rounding.x, clamp(ph.x + 0.5, 0.0, 1.0)) * roundingMult;
    let newMask = easeOut(smoothStart(sloping * onset.y, roundingForOctave * onset.y));
    combiMask = powInv(combiMask, detail) * newMask;

    ridgeMapFadeTarget = mix(ridgeMapFadeTarget, gullies.x, ridgeMapCombiMask);
    ridgeMapCombiMask *= easeOut(sloping * onset.w);

    strength *= gain;
    freq *= lacunarity;
    roundingMult *= rounding.w;
  }

  var o: Eroded;
  o.delta = heightAndSlope - heightAndSlopeIn;
  o.magnitude = magnitude;
  o.ridges = ridgeMapFadeTarget * (1.0 - ridgeMapCombiMask);
  return o;
}
