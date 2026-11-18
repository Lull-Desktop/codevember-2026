// The man: a long coat, seen from above and behind, small in the frame. Built in metres from a few capsules
// and one coat, and walked by placing his feet: a foot on the ground stays where it is while he goes over it,
// and the knee is wherever the two halves of the leg meet.
import { BufferAttribute, BufferGeometry, CapsuleGeometry, Group, Material, Mesh, Quaternion, SphereGeometry, Vector3, Vector4, BoxGeometry } from "three/webgpu";

export const METRE = 1 / 1.6; // a cell is 1.6 m wide
const THIGH = 0.46;
const SHIN = 0.46;
const ANKLE = 0.085;
const HIP = 0.095; // half the distance between the hip joints
const STANCE = 0.6; // share of a stride a foot spends on the ground

export type Tone = "coat" | "cloth" | "shoe" | "skin" | "hair";

const UP = new Vector3(0, 1, 0);
const q = new Quaternion();
const d = new Vector3();
// lay a capsule that was made standing, between two points
const between = (mesh: Mesh, a: Vector3, b: Vector3) => {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  d.copy(b).sub(a).normalize();
  mesh.quaternion.copy(q.setFromUnitVectors(UP, d));
};

// the coat: rings of (height, half width, half depth), shoulders to hem
const RINGS = [
  [0.43, 0.262, 0.205],
  [0.56, 0.25, 0.192],
  [0.72, 0.232, 0.176],
  [0.88, 0.212, 0.158],
  [1.02, 0.202, 0.148],
  [1.16, 0.21, 0.15],
  [1.3, 0.226, 0.152],
  [1.4, 0.232, 0.146],
  [1.46, 0.214, 0.13],
  [1.5, 0.15, 0.1],
  [1.535, 0.075, 0.072],
  [1.56, 0.062, 0.062],
];
const AROUND = 28;

export function createMan(material: (tone: Tone) => Material) {
  const group = new Group();
  const body = new Group(); // everything above the legs: leans and turns as one
  group.add(body);
  group.scale.setScalar(METRE);

  const mats = { coat: material("coat"), cloth: material("cloth"), shoe: material("shoe"), skin: material("skin"), hair: material("hair") };
  const cap = (r: number, len: number, tone: Tone, parent: Group = group) => {
    const m = new Mesh(new CapsuleGeometry(r, len, 6, 14), mats[tone]);
    parent.add(m);
    return m;
  };

  // coat
  const rest = new Float32Array(RINGS.length * AROUND * 3);
  RINGS.forEach(([y, rx, rz], r) => {
    for (let a = 0; a < AROUND; a++) {
      const t = (a / AROUND) * Math.PI * 2;
      // a little squarer than an ellipse: a coat hangs from the shoulders
      const c = Math.cos(t);
      const s = Math.sin(t);
      const k = 1 / Math.pow(Math.pow(Math.abs(c), 2.6) + Math.pow(Math.abs(s), 2.6), 1 / 2.6);
      rest.set([rx * c * k, y, rz * s * k], (r * AROUND + a) * 3);
    }
  });
  const index: number[] = [];
  for (let r = 0; r < RINGS.length - 1; r++)
    for (let a = 0; a < AROUND; a++) {
      const a1 = (a + 1) % AROUND;
      const i0 = r * AROUND + a;
      const i1 = r * AROUND + a1;
      index.push(i0, i0 + AROUND, i1, i1, i0 + AROUND, i1 + AROUND);
    }
  const coatGeo = new BufferGeometry();
  const coatPos = new BufferAttribute(rest.slice(), 3);
  coatGeo.setAttribute("position", coatPos);
  coatGeo.setIndex(index);
  coatGeo.computeVertexNormals();
  const coat = new Mesh(coatGeo, mats.coat);
  coat.frustumCulled = false;
  body.add(coat);

  // head, neck, hair
  const head = new Mesh(new SphereGeometry(0.104, 20, 14), mats.skin);
  head.scale.set(0.95, 1.14, 1.06);
  body.add(head);
  const hair = new Mesh(new SphereGeometry(0.108, 20, 14), mats.hair);
  hair.scale.set(0.96, 1.05, 1.06);
  body.add(hair);
  const neck = cap(0.05, 0.08, "skin", body);

  // arms hang from the shoulders
  const arms = [-1, 1].map((side) => ({ side, upper: cap(0.06, 0.25, "coat", body), fore: cap(0.052, 0.24, "coat", body), hand: new Mesh(new SphereGeometry(0.046, 10, 8), mats.skin) }));
  arms.forEach((a) => body.add(a.hand));

  // legs
  const legs = [-1, 1].map((side) => {
    const shoe = new Mesh(new BoxGeometry(0.098, 0.075, 0.275), mats.shoe);
    group.add(shoe);
    return { side, thigh: cap(0.082, THIGH - 0.1, "cloth"), shin: cap(0.066, SHIN - 0.08, "cloth"), shoe, hip: new Vector3(), knee: new Vector3(), ankle: new Vector3() };
  });

  // what casts his shadow: capsules, from a to b with radius in a.w, in the world
  const COUNT = 8;
  const capsA = Array.from({ length: COUNT }, () => new Vector4());
  const capsB = Array.from({ length: COUNT }, () => new Vector4());
  const world = new Vector3();
  const put = (n: number, a: Vector3, b: Vector3, r: number, from: Group) => {
    world.copy(a);
    from.localToWorld(world);
    capsA[n].set(world.x, world.y, world.z, r * METRE);
    world.copy(b);
    from.localToWorld(world);
    capsB[n].set(world.x, world.y, world.z, 0);
  };

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const foot = { z: 0, y: 0, pitch: 0 };
  // where a foot is, `u` of a stride after it came down: metres ahead of the hips, height of the ankle, and how the shoe tips
  const step = (u: number, reach: number) => {
    if (u < STANCE) {
      const s = u / STANCE;
      const lift = Math.min(1, Math.max(0, (s - 0.72) / 0.28));
      foot.z = reach * (1 - 2 * s);
      foot.y = ANKLE + 0.06 * lift * lift;
      foot.pitch = 0.3 * Math.max(0, 1 - s / 0.14) - 0.75 * lift * lift;
    } else {
      const s = (u - STANCE) / (1 - STANCE);
      const e = s * s * (3 - 2 * s);
      foot.z = reach * (2 * e - 1);
      foot.y = ANKLE + 0.06 * (1 - s) + 0.1 * Math.sin(Math.PI * s);
      foot.pitch = -0.75 * (1 - e) + 0.3 * e;
    }
  };

  // phase: strides walked (its fraction is where in the stride he is); stride: metres; forward is -z
  const pose = (phase: number, stride: number) => {
    const p = phase - Math.floor(phase);
    const turn = Math.PI * 2 * p;
    const reach = (STANCE / 2) * stride;
    // the hips come down as a foot lands and ride over the leg that stands
    const hipY = 0.918 - 0.024 * Math.cos(2 * turn);
    const sway = 0.02 * Math.sin(turn - 0.9);
    body.position.set(sway * 0.6, hipY - 0.918, 0);
    body.rotation.set(-0.075 + 0.012 * Math.cos(2 * turn), 0.07 * Math.sin(turn), -0.018 * Math.sin(turn - 0.9));

    for (const leg of legs) {
      // the right leg is half a stride behind the left
      const u = (p + (leg.side > 0 ? 0.5 : 0)) % 1;
      step(u, reach);
      leg.hip.set(leg.side * HIP + sway, hipY, 0);
      leg.ankle.set(leg.side * (HIP - 0.02), foot.y, -foot.z);
      // the knee: where two circles meet, on the forward side
      d.copy(leg.ankle).sub(leg.hip);
      const len = Math.min(d.length(), THIGH + SHIN - 0.002);
      d.normalize();
      const along = (THIGH * THIGH - SHIN * SHIN + len * len) / (2 * len);
      const out = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
      // forward (-z), made square to the leg
      c.set(0, 0, -1).addScaledVector(d, d.z).normalize();
      leg.knee.copy(leg.hip).addScaledVector(d, along).addScaledVector(c, out);
      between(leg.thigh, leg.hip, leg.knee);
      between(leg.shin, leg.knee, leg.ankle);
      leg.shoe.position.set(leg.ankle.x, leg.ankle.y - 0.045 - 0.03 * Math.sin(foot.pitch), leg.ankle.z - 0.07 * Math.cos(foot.pitch));
      leg.shoe.rotation.set(foot.pitch, 0, 0);
    }

    // the coat's skirt goes with the knees: each half is carried by its own leg
    const kneeL = legs[0].knee.z;
    const kneeR = legs[1].knee.z;
    const array = coatPos.array as Float32Array;
    for (let i = 0; i < array.length; i += 3) {
      const x = rest[i];
      const y = rest[i + 1];
      const low = Math.min(1, Math.max(0, (0.95 - y) / 0.52));
      if (low <= 0) continue;
      const right = Math.min(1, Math.max(0, 0.5 + x / 0.24));
      const knee = kneeL + (kneeR - kneeL) * right * right * (3 - 2 * right);
      // (the body leans, so the skirt is found in the body's frame: near enough)
      array[i + 2] = rest[i + 2] + low * low * knee * 0.62;
      array[i] = x * (1 + 0.05 * low * Math.cos(2 * turn));
    }
    coatPos.needsUpdate = true;
    coatGeo.computeVertexNormals();

    head.position.set(0, 1.665, -0.012);
    hair.position.set(0, 1.69, 0.016);
    a.set(0, 1.53, 0);
    b.set(0, 1.6, -0.005);
    between(neck, a, b);

    for (const arm of arms) {
      // an arm swings with the opposite leg
      const swing = 0.34 * Math.cos(turn) * arm.side;
      const bend = 0.28 + 0.22 * Math.max(0, swing) + 0.08;
      a.set(arm.side * 0.243, 1.41, 0);
      b.set(arm.side * 0.268, 1.41 - 0.29 * Math.cos(swing), -0.29 * Math.sin(swing));
      c.set(arm.side * 0.262, b.y - 0.27 * Math.cos(swing + bend), b.z - 0.27 * Math.sin(swing + bend));
      between(arm.upper, a, b);
      between(arm.fore, b, c);
      arm.hand.position.copy(c).addScaledVector(d.copy(c).sub(b).normalize(), 0.05);
    }

    group.updateMatrixWorld(true);
    a.set(0, 0.66, 0);
    b.set(0, 1.36, 0);
    put(0, a, b, 0.19, body);
    a.set(0, 1.655, 0);
    b.set(0, 1.685, 0);
    put(1, a, b, 0.108, body);
    legs.forEach((leg, n) => {
      put(2 + n * 2, leg.hip, leg.knee, 0.085, group);
      put(3 + n * 2, leg.knee, leg.ankle, 0.07, group);
    });
    arms.forEach((arm, n) => {
      a.set(arm.side * 0.25, 1.41, 0);
      put(6 + n, a, arm.hand.position, 0.058, body);
    });
  };

  return { group, pose, capsA, capsB, count: COUNT };
}
