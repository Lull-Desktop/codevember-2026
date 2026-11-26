// The wandering river (river.ts), drawn as the old maps of the Mississippi were: the plain keeps every place
// the channel has been, a colour a time, and the loops it has cut off lie on it as lakes.
import type { Def, Sim } from "../util";
import { makeRiver, type Loop } from "./river";

export const meanders: Def = {
  id: "meanders",
  title: "Meanders",
  paper: "Ikeda, Parker & Sawai 1981 · Howard & Knutson 1984",
  note: "Bank wear follows upstream curvature. Every colour is where the channel once ran; loops that touch are cut off.",
  steps: 8,
  make(seed): Sim {
    const SPAN = 260; // the picture's width
    const river = makeRiver(seed, {
      from: -70,
      to: SPAN + 70,
      mid: SPAN / 2,
      reach: SPAN * 0.42,
    });
    const lakes: Loop[] = [];
    const plain = document.createElement("canvas");
    plain.width = plain.height = 700;
    const pc = plain.getContext("2d")!;
    pc.fillStyle = "#e9e0cf";
    pc.fillRect(0, 0, 700, 700);
    return {
      step() {
        river.step();
        const { x, y, time } = river;
        lakes.push(...river.cut);
        for (const l of lakes) l.age++;
        while (lakes.length && lakes[0].age > 1500) lakes.shift();
        if (time % 6 === 0) {
          const k = 700 / SPAN;
          pc.strokeStyle = `hsl(${34 + 26 * Math.sin(time * 0.0017)},${30 + 14 * Math.sin(time * 0.0041 + 1)}%,${60 + 13 * Math.sin(time * 0.013)}%)`;
          pc.lineWidth = 2.3 * k;
          pc.lineJoin = "round";
          pc.beginPath();
          for (let i = 0; i < x.length; i++) pc.lineTo(x[i] * k, y[i] * k);
          pc.stroke();
        }
      },
      draw(ctx, size) {
        const { x, y } = river;
        ctx.drawImage(plain, 0, 0, size, size);
        const k = size / SPAN;
        ctx.lineJoin = ctx.lineCap = "round";
        for (const l of lakes) {
          ctx.strokeStyle = `rgba(52,92,112,${0.75 * (1 - l.age / 1500)})`;
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          for (let i = 0; i < l.x.length; i++)
            ctx.lineTo(l.x[i] * k, l.y[i] * k);
          ctx.stroke();
        }
        ctx.strokeStyle = "#17384a";
        ctx.lineWidth = 2.2 * k;
        ctx.beginPath();
        for (let i = 0; i < x.length; i++) ctx.lineTo(x[i] * k, y[i] * k);
        ctx.stroke();
      },
    };
  },
};
