import { probe, GUI, config } from "./prelude";
import "../src/volvox/index.ts";
import { bootPreparedScene } from "../../tools/lull/runtime/boot";
import type {
  GuiConstructor,
  SceneConfig,
} from "../../tools/lull/runtime/types";

void bootPreparedScene({
  config: config as unknown as SceneConfig,
  probe,
  GUI: GUI as unknown as GuiConstructor,
});
