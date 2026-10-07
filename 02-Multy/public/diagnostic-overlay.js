// Read-only evidence: do not remove, click or authorize extension-owned UI.
export function inspectDiagnosticOverlay(doc = document, win = window) {
  const describe = node => {
    const style = win.getComputedStyle(node), rect = node.getBoundingClientRect();
    return { tag: node.tagName, id: node.id || '', classes: String(node.className || '').slice(0, 160),
      display: style.display, position: style.position, opacity: style.opacity, pointerEvents: style.pointerEvents,
      zIndex: style.zIndex, inert: Boolean(node.inert), shadowRoot: Boolean(node.shadowRoot),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
  };
  const targets = ['copy-diagnostics', 'reload-diagnostics'].map(id => {
    const button = doc.getElementById(id), rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return { id, disabled: button.disabled, inViewport: x >= 0 && y >= 0 && x < win.innerWidth && y < win.innerHeight,
      stack: doc.elementsFromPoint(x, y).slice(0, 5).map(describe) };
  });
  return { body: describe(doc.body), root: describe(doc.documentElement), targets,
    candidates: [...doc.querySelectorAll('dialog[open], iframe, [inert], [id*="beacio"], [class*="beacio"]')].slice(0, 20).map(describe) };
}
