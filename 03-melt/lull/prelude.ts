import GUI from "three/addons/libs/lil-gui.module.min.js";
import { prepareScene } from "../../tools/lull/runtime/boot";
import type {
  GuiConstructor,
  SceneConfig,
} from "../../tools/lull/runtime/types";
import config from "./scene.json";

// Evaluated before ../src/index.ts (see entry.ts), so the storage shim and the
// GUI probe are installed before the sketch module runs.
export const probe = prepareScene(
  GUI as unknown as GuiConstructor,
  config as unknown as SceneConfig,
);

export { GUI, config };
