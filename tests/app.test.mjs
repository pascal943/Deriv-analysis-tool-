import test from "node:test";
import assert from "node:assert/strict";

test("startup uses the restored duration and keeps following input changes", async (t) => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    WebSocket: globalThis.WebSocket,
  };
  const elements = new Map(),
    windowEvents = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "duration" ? "12" : "",
        events: new Map(),
        addEventListener(name, callback) {
          this.events.set(name, callback);
        },
        classList: { add() {}, remove() {} },
        append() {},
        after() {},
        replaceChildren() {},
        close() {},
      });
    return elements.get(id);
  };
  globalThis.document = {
    getElementById: element,
    querySelectorAll: () => [],
    createElement: () => ({}),
  };
  globalThis.window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
  };
  globalThis.WebSocket = class {
    constructor() {
      this.readyState = 0;
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  };
  t.after(async () => {
    windowEvents.get("pagehide")?.();
    await new Promise((resolve) => setImmediate(resolve));
    Object.assign(globalThis, previous);
  });
  await import("../web/app.js");
  assert.equal(
    element("signal-horizon").textContent,
    "12-minute outlook · follows trade duration",
  );
  element("duration").value = "7";
  element("duration").events.get("input")();
  assert.equal(
    element("signal-horizon").textContent,
    "7-minute outlook · follows trade duration",
  );
});
