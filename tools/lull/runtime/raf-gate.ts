// The Lull host disables background throttling for its WebViews, so a hidden
// wallpaper would otherwise keep rendering at full speed. This gate pauses
// requestAnimationFrame callbacks while the scene is not visible and resumes
// them when it comes back. It is deliberately generic: all sketches use rAF.

const GATE = Symbol.for("lull.raf.gate");

export interface RafGate {
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

type GateGlobal = typeof globalThis & {
  [GATE]?: RafGate;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
};

export function installRafGate(): RafGate {
  const target = globalThis as GateGlobal;
  const existing = target[GATE];
  if (existing) return existing;

  const nativeRaf = target.requestAnimationFrame.bind(target);
  const nativeCancel = target.cancelAnimationFrame.bind(target);
  const queued = new Map<number, FrameRequestCallback>();
  let visible = true;
  let nextId = 1;

  const gate: RafGate = {
    setVisible(next: boolean) {
      if (next === visible) return;
      visible = next;
      if (!next) return;

      const pending = Array.from(queued.values());
      queued.clear();
      for (const callback of pending) nativeRaf(callback);
    },
    dispose() {
      target.requestAnimationFrame = nativeRaf;
      target.cancelAnimationFrame = nativeCancel;
      queued.clear();
      delete target[GATE];
    },
  };

  target.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    if (visible) return nativeRaf(callback);
    const id = nextId++;
    queued.set(id, callback);
    return id;
  };
  target.cancelAnimationFrame = (id: number): void => {
    if (queued.delete(id)) return;
    nativeCancel(id);
  };
  Object.defineProperty(target, GATE, { value: gate });

  return gate;
}