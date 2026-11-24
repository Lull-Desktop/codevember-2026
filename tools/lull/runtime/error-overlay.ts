// A visible failure state is better than a white wallpaper. The original pages
// have a #loader element with a .failed style; reuse it when present, otherwise
// create a small fixed overlay.

let overlay: HTMLElement | null = null;

export function showSceneError(message: string): void {
  if (typeof document === "undefined") return;

  const loader = document.querySelector<HTMLElement>("#loader");
  if (loader) {
    loader.classList.add("failed");
    loader.classList.remove("done");
    const text = loader.querySelector<HTMLElement>("p, span");
    if (text) text.textContent = message;
    else loader.textContent = message;
    return;
  }

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lull-error";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:24px",
      "box-sizing:border-box",
      "background:rgba(8,10,12,.92)",
      "color:#e8edf2",
      "font:400 14px/1.6 system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif",
      "text-align:center",
      "white-space:pre-wrap",
    ].join(";");
    document.body.appendChild(overlay);
  }

  overlay.textContent = message;
}

export function clearSceneError(): void {
  overlay?.remove();
  overlay = null;
}