// A minimal `SceneFrame` for browser previews and for the case where the scene
// is opened outside Lull. It mirrors the fields the host sends so the sketch can
// be developed with the same `onFrame` path.

import type { SceneConfig, SceneParamValue } from "./types";
import type { SceneFrame } from "@lull/scene-sdk";

export function createFallbackFrame(
  config: SceneConfig,
  search = typeof location === "undefined" ? "" : location.search,
): SceneFrame {
  const query = new URLSearchParams(search);
  const params: Record<string, SceneParamValue> = {};

  for (const spec of config.params ?? []) {
    const raw = query.get(spec.key);
    if (raw === null) {
      params[spec.key] = spec.default;
      continue;
    }

    if (spec.type === "number") {
      const value = Number(raw);
      params[spec.key] = Number.isFinite(value) ? value : spec.default;
    } else if (spec.type === "boolean") {
      params[spec.key] = raw === "true" || raw === "1";
    } else {
      params[spec.key] = raw;
    }
  }

  const width = Math.max(1, window.innerWidth || 1280);
  const height = Math.max(1, window.innerHeight || 720);
  const dpr = Math.max(0.5, window.devicePixelRatio || 1);

  return {
    mode: "mirror",
    layout: "viewport",
    sync: { enabled: false, epochMs: 0 },
    viewport: { w: width, h: height, dpr },
    canvas: null,
    view: null,
    dpr,
    params,
    reducedMotion:
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    performance: config.performance?.tier
      ? {
          tier: config.performance.tier,
          targetFps: config.performance.targetFps,
        }
      : null,
  };
}