// Lull scene bootstrap.
//
// The entry is split into two modules so the prelude can install the storage
// shim and the lil-gui probe *before* the sketch module is evaluated:
//
//   entry.ts
//     import { probe, GUI, config } from "./prelude";  // installs first
//     import "../src/index";                            // sketch runs second
//     bootPreparedScene({ config, probe, GUI });        // bridge starts third
//
// This avoids a dynamic import in the bundled package (which Rollup inlines
// with a TDZ hazard around top-level-await modules).

import {
  connectLullScene,
  LullSceneError,
  type LullSceneClient,
  type SceneFrame,
  type SceneParamValue,
} from "@lull/scene-sdk";
import { showSceneError } from "./error-overlay";
import { createFallbackFrame } from "./fallback-frame";
import { installGuiProbe, type GuiProbe } from "./gui-probe";
import { createParamApplier, resolveSceneParams } from "./params";
import { installRafGate } from "./raf-gate";
import { installStorageShim } from "./storage-shim";
import type { GuiConstructor, SceneConfig } from "./types";

export interface BootOptions {
  config: SceneConfig;
  probe: GuiProbe;
  GUI?: GuiConstructor;
}

type LogLevel = "info" | "warn" | "error";

/**
 * Runs at prelude module evaluation, before the sketch is imported. Installs
 * the opaque-origin storage shim, error reporting, the rAF gate and the GUI
 * probe. Returns the probe for the entry to pass to bootPreparedScene.
 */
export function prepareScene(
  GUI: GuiConstructor,
  config: SceneConfig,
): GuiProbe {
  installStorageShim();
  installErrorHandlers();
  installRafGate();

  if (config.requires?.includes("webgpu") && !hasWebGpu()) {
    showSceneError(
      "这个场景需要 WebGPU。\n请确认 Lull 使用的 WebView2 已启用 WebGPU，然后重新加载壁纸。",
    );
  }

  return installGuiProbe(GUI);
}

/** Runs after the sketch module has been evaluated. */
export async function bootPreparedScene(options: BootOptions): Promise<void> {
  const { config, probe } = options;

  await waitForScene(probe);

  const preview = window.parent === window;
  if (preview) addPreviewBadge(config);

  let client: LullSceneClient | undefined;
  let log: (message: string, level?: LogLevel) => void = (message, level) => {
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
    console[method](`[lull] ${message}`);
  };

  if (!preview) {
    try {
      client = await connectLullScene({ timeoutMs: 10_000 });
      log = (message, level) =>
        client?.log(message, level === "info" ? "log" : level ?? "log");
    } catch (error) {
      log(
        `scene bridge unavailable: ${formatError(error)}`,
        error instanceof LullSceneError && error.code === "not-embedded"
          ? "info"
          : "warn",
      );
    }
  }

  const resolved = resolveSceneParams(probe, config, log);
  const applier = createParamApplier(resolved, { log });
  const gate = installRafGate();

  let first = true;
  let reduced = false;

  const applyFrame = (frame: SceneFrame) => {
    let params = frame.params as Record<string, SceneParamValue>;

    if (frame.reducedMotion !== reduced) {
      reduced = frame.reducedMotion;
      if (reduced && config.reducedMotion) {
        params = {
          ...params,
          [config.reducedMotion.param]: config.reducedMotion.value,
        };
      }
      applier.apply(params, { force: true, log });
      first = false;
      return;
    }

    applier.apply(params, { force: first, log });
    first = false;
  };

  if (client) {
    client.onFrame(applyFrame);
    client.onVisibility((visible) => gate.setVisible(visible));
    gate.setVisible(client.visible);
    log(
      `ready (hostApi ${client.hostApi}, protocol ${client.protocol}, ${resolved.length} params)`,
    );
  } else {
    const frame = createFallbackFrame(config);
    gate.setVisible(true);
    applyFrame(frame);
    log(`preview frame (${window.innerWidth}x${window.innerHeight})`);
  }

  window.addEventListener(
    "pagehide",
    () => {
      client?.destroy();
      applier.dispose();
      gate.dispose();
    },
    { once: true },
  );
}

function hasWebGpu(): boolean {
  const nav = navigator as Navigator & { gpu?: unknown };
  return typeof nav.gpu !== "undefined" && nav.gpu !== null;
}

async function waitForScene(probe: GuiProbe): Promise<void> {
  const start = performance.now();
  let canvasSeenAt = 0;

  while (performance.now() - start < 20_000) {
    const hasCanvas = document.querySelector("canvas") !== null;
    if (hasCanvas && canvasSeenAt === 0) canvasSeenAt = performance.now();

    if (hasCanvas && probe.controllers().length > 0) return;

    // Some sketches have no GUI at all. Once a canvas exists, give the GUI a
    // short grace period and then continue.
    if (hasCanvas && performance.now() - canvasSeenAt > 2_000) return;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.warn("[lull] timed out waiting for canvas/GUI; continuing");
}

function installErrorHandlers(): void {
  const report = (error: unknown) => {
    console.error("[lull] unhandled scene error", error);
    const running = document.querySelector("canvas") !== null;
    if (!running) showSceneError(formatError(error));
  };

  window.addEventListener("error", (event) => report(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
}

function addPreviewBadge(config: SceneConfig): void {
  const badge = document.createElement("div");
  badge.id = "lull-preview-badge";
  badge.textContent = `Lull preview · ${config.id} · 参数可用 ?key=value 覆盖`;
  badge.style.cssText = [
    "position:fixed",
    "left:10px",
    "bottom:10px",
    "z-index:2147483646",
    "padding:6px 9px",
    "border-radius:5px",
    "background:rgba(0,0,0,.55)",
    "color:#e9eef3",
    "font:11px/1.3 ui-monospace,Consolas,monospace",
    "pointer-events:none",
    "opacity:.8",
  ].join(";");
  document.body.appendChild(badge);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}