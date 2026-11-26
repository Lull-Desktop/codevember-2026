// What changes with every frame: the camera, the sky, the light, and the look values of the picture.

struct Frame {
  view: mat4x4f,  // world to screen
  shade: mat4x4f, // world to the map of what the light sees
  turn: mat4x4f,  // the rock's space to the world, for the arch at the start of the row
  eye: vec4f,     // the eye; seconds into the loop
  right: vec4f,   // the camera's right; tan of half the view times the aspect
  up: vec4f,      // the camera's up; tan of half the view
  ahead: vec4f,   // where the camera looks; size of a cell
  light: vec4f,   // towards the sun or, by night, the moon; 1 if it is the sun
  glare: vec4f,   // the colour of that light where the arch stands; how much of the ground's light comes back up
  sun: vec4f,     // towards the sun; how much it is night, 0 … 1
  dusk: vec4f,    // towards the sun the sky is worked out from, which sinks slower; how dark it has got, 0 … 1
  sunTone: vec4f, // the sun's colour as clouds and the sky near it have it; how bright the sky is
  moon: vec4f,    // towards the moon; how bright
  high: vec4f,    // light from the upper sky; strength of the rim
  near: vec4f,    // light from the sky low on the light's side; haze
  away: vec4f,    // and low on the other side; brightness of the stars
  pole: vec4f,    // the point the sky turns round; how far it has turned
  mid: vec4f,     // the point of the sky's equator due south; length of a star's trail
  size: vec4f,    // of the picture; grain; lines
  tone: vec4f,    // patina, ao strength, shadow softness, what to show
  wind: vec4f,    // where the wind blows to in the world; its speed
  sand: vec4f,    // size of a grain, brightness, swirl, how many start
  row: vec4f,     // sideways and forward to the next arch; how many there are; how much has piled up at the foot
  drift: vec4f,   // where the clouds have got to (tiles, two layers)
  cloud: vec4f,   // cover; density; size of a tile; how far the clouds have boiled
  land: vec4f,    // height of the dunes; of the ripples; how far the ripples have crept; brightness of the sand
};
@group(0) @binding(1) var<uniform> F: Frame;

fn lin(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}
