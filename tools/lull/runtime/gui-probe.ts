// Records lil-gui roots created by the original sketch, so the scene can map
// Lull params onto the controls the author already wired up. No sketch changes
// are required: we patch the prototype before the sketch module is imported.

import type {
  GuiConstructor,
  GuiController,
  GuiInstance,
} from "./types";

const PATCHED = Symbol.for("lull.gui.patched");
const ROOTS = Symbol.for("lull.gui.roots");

export interface ControllerEntry {
  /** Folder path + display name, e.g. "light/light shafts". */
  path: string;
  /** Controller display name (lil-gui `_name`). */
  name: string;
  /** Underlying object property (lil-gui `_property`). */
  property: string;
  controller: GuiController;
}

export interface GuiProbe {
  roots: Set<GuiInstance>;
  controllers: () => ControllerEntry[];
}

type PatchedPrototype = GuiConstructor["prototype"] & {
  [PATCHED]?: boolean;
  [ROOTS]?: Set<GuiInstance>;
  add: (...args: unknown[]) => GuiController;
  addColor?: (...args: unknown[]) => GuiController;
  addFolder: (...args: unknown[]) => GuiInstance;
};

export function installGuiProbe(GUI: GuiConstructor): GuiProbe {
  const proto = GUI.prototype as PatchedPrototype;

  if (!proto[PATCHED]) {
    const roots = new Set<GuiInstance>();
    const originalAdd = proto.add;
    const originalAddFolder = proto.addFolder;
    const originalAddColor = proto.addColor;

    const register = (gui: GuiInstance) => {
      const root = gui.root ?? gui;
      roots.add(root);
    };

    proto.add = function patchedAdd(this: GuiInstance, ...args: unknown[]) {
      register(this);
      return originalAdd.apply(this, args);
    };
    proto.addFolder = function patchedAddFolder(
      this: GuiInstance,
      ...args: unknown[]
    ) {
      register(this);
      return originalAddFolder.apply(this, args);
    };
    if (typeof originalAddColor === "function") {
      proto.addColor = function patchedAddColor(
        this: GuiInstance,
        ...args: unknown[]
      ) {
        register(this);
        return originalAddColor.apply(this, args);
      };
    }

    Object.defineProperty(proto, ROOTS, { value: roots });
    Object.defineProperty(proto, PATCHED, { value: true });
  }

  const roots = proto[ROOTS] ?? new Set<GuiInstance>();

  return {
    roots,
    controllers: () => collectControllers(roots),
  };
}

function collectControllers(roots: Set<GuiInstance>): ControllerEntry[] {
  const entries: ControllerEntry[] = [];
  const seen = new Set<string>();

  const walk = (gui: GuiInstance, prefix: string) => {
    for (const controller of gui.controllers ?? []) {
      const name = String(controller._name ?? "");
      // lil-gui versions differ: newer builds use `property`, some older
      // type definitions expose `_property`.
      const property = String(
        controller._property ?? controller.property ?? "",
      );
      const path = prefix ? `${prefix}/${name}` : name;
      if (seen.has(path)) continue;
      seen.add(path);
      entries.push({ path, name, property, controller });
    }

    for (const folder of gui.folders ?? []) {
      const title = String(folder._title ?? "");
      walk(folder, prefix ? `${prefix}/${title}` : title);
    }
  };

  for (const root of roots) walk(root, "");
  return entries;
}