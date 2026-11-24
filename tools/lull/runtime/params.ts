// Maps Lull `frame.params` onto the lil-gui controllers that already exist in
// the sketch. Keeping this layer generic is what lets 18 very different
// sketches share one scene manifest.

import type { ControllerEntry, GuiProbe } from "./gui-probe";
import type { SceneConfig, SceneParamSpec, SceneParamValue } from "./types";

export interface ResolvedParam {
  spec: SceneParamSpec;
  entry?: ControllerEntry;
}

export interface ApplyOptions {
  force?: boolean;
  log?: (message: string, level?: "info" | "warn" | "error") => void;
}

type ParamBag = Record<string, SceneParamValue>;

const DEBOUNCE_MS = 200;

export function resolveSceneParams(
  probe: GuiProbe,
  config: SceneConfig,
  log?: ApplyOptions["log"],
): ResolvedParam[] {
  const entries = probe.controllers();
  const specs = config.params ?? [];

  return specs.map((spec) => {
    const binding = spec.binding;
    let matches: ControllerEntry[] = [];

    if (binding?.property) {
      matches = entries.filter((entry) => entry.property === binding.property);
    } else if (binding?.gui) {
      const wanted = binding.gui;
      matches = entries.filter(
        (entry) => entry.path === wanted || entry.name === wanted,
      );
      if (matches.length === 0 && wanted.includes("/")) {
        matches = entries.filter((entry) => entry.path.endsWith(`/${wanted}`));
      }
    }

    if (matches.length === 0) {
      log?.(
        `param "${spec.key}" has no matching GUI controller (${JSON.stringify(binding)})`,
        "warn",
      );
      return { spec };
    }

    if (matches.length > 1) {
      const exact = binding?.gui
        ? matches.filter((entry) => entry.path === binding.gui)
        : [];
      if (exact.length === 1) {
        matches = exact;
      } else {
        log?.(
          `param "${spec.key}" matched ${matches.length} controllers; using "${matches[0].path}"`,
          "warn",
        );
        matches = [matches[0]];
      }
    }

    return { spec, entry: matches[0] };
  });
}

export function createParamApplier(
  resolved: ResolvedParam[],
  options: ApplyOptions & { config?: SceneConfig } = {},
) {
  const last = new Map<string, string | number | boolean>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const apply = (params: ParamBag, applyOptions: ApplyOptions = {}) => {
    const force = applyOptions.force ?? options.force ?? false;
    const log = applyOptions.log ?? options.log;

    for (const item of resolved) {
      const { spec, entry } = item;
      if (!entry) continue;

      const raw =
        params[spec.key] === undefined ? spec.default : params[spec.key];
      const value = normalizeValue(spec, raw);
      if (value === undefined) {
        log?.(
          `param "${spec.key}" has an invalid value: ${String(raw)}`,
          "warn",
        );
        continue;
      }

      const previous = last.get(spec.key);
      if (!force && sameValue(previous, value)) continue;
      last.set(spec.key, value);

      const commit = () => {
        writeController(entry, spec, value, spec.apply === "finish");
        timers.delete(spec.key);
      };

      const existing = timers.get(spec.key);
      if (existing !== undefined) clearTimeout(existing);

      if (force || spec.apply !== "finish") {
        commit();
      } else {
        timers.set(spec.key, setTimeout(commit, DEBOUNCE_MS));
      }
    }
  };

  const dispose = () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  return { apply, dispose };
}

function normalizeValue(
  spec: SceneParamSpec,
  raw: unknown,
): string | number | boolean | undefined {
  switch (spec.type) {
    case "number": {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) return undefined;
      let next = value;
      if (typeof spec.min === "number") next = Math.max(spec.min, next);
      if (typeof spec.max === "number") next = Math.min(spec.max, next);
      return next;
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === 1 || raw === "1") return true;
      if (raw === "false" || raw === 0 || raw === "0") return false;
      return undefined;
    case "color": {
      const value = String(raw);
      return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
    }
    case "enum": {
      const mapped = spec.map?.value?.[String(raw)] ?? raw;
      if (typeof mapped !== "string" && typeof mapped !== "number") {
        return undefined;
      }
      return mapped;
    }
    case "string":
    case "text":
      return typeof raw === "string" ? raw : String(raw);
    default:
      return undefined;
  }
}

function sameValue(
  previous: string | number | boolean | undefined,
  next: string | number | boolean,
): boolean {
  if (previous === undefined) return false;
  if (typeof previous === "number" && typeof next === "number") {
    return Math.abs(previous - next) < 1e-9;
  }
  return previous === next;
}

function writeController(
  entry: ControllerEntry,
  spec: SceneParamSpec,
  value: string | number | boolean,
  finish: boolean,
): void {
  const controller = entry.controller;

  // ColorController.load() knows how to turn "#rrggbb" into the controller's
  // native format (number, array, object or THREE.Color). setValue() would
  // assign the raw string and break the material.
  //
  // load() additionally fires onFinishChange, which is what structural params
  // (geometry rebuilds) listen to. Continuous params use setValue() so the
  // sliders keep their normal drag behavior.
  if (!finish && spec.type !== "color" && typeof controller.setValue === "function") {
    controller.setValue(value);
  } else if (typeof controller.load === "function") {
    controller.load(value);
  } else if (typeof controller.setValue === "function") {
    controller.setValue(value);
  }

  controller.updateDisplay?.();
}