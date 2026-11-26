// What changes with every frame: the camera, the sun, the turn of the rock, and the look values of the picture.

struct Frame {
  view: mat4x4f,  // world to screen
  shade: mat4x4f, // world to the sun's map
  model: mat4x4f, // the rock's space to the world
  eye: vec4f,     // the eye; time in seconds
  right: vec4f,   // the camera's right; tan of half the view times the aspect
  up: vec4f,      // the camera's up; tan of half the view
  ahead: vec4f,   // where the camera looks; size of a cell
  sun: vec4f,     // towards the sun; its strength
  sky: vec4f,     // sky strength, haze, rim, bounce
  size: vec4f,    // of the picture; grain; lines
  tone: vec4f,    // patina, ao strength, shadow softness, what to show
  wind: vec4f,    // where the wind blows to in the world; its speed
  sand: vec4f,    // size of a grain, brightness, swirl, how fast it falls
};
@group(0) @binding(1) var<uniform> F: Frame;
