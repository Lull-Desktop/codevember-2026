// node tools/arch-seam.mjs a.png b.png ...: the mean and the largest difference between each picture and the next.
import { execFileSync } from "node:child_process";
const files = process.argv.slice(2);
for (let i = 0; i + 1 < files.length; i++) {
  const raw = (f) =>
    execFileSync("convert", [f, "-depth", "8", "rgb:-"], {
      maxBuffer: 1 << 28,
    });
  const a = raw(files[i]);
  const b = raw(files[i + 1]);
  let sum = 0;
  let most = 0;
  let many = 0;
  for (let k = 0; k < a.length; k++) {
    const d = Math.abs(a[k] - b[k]);
    sum += d;
    most = Math.max(most, d);
    if (d > 12) many++;
  }
  console.log(
    `${files[i].split("/").pop()} → ${files[i + 1].split("/").pop()}: mean ${(sum / a.length).toFixed(3)}, most ${most}, over 12: ${((100 * many) / a.length).toFixed(3)}%`,
  );
}
