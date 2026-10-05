import test from "node:test";
import assert from "node:assert/strict";
import { SignalPanel } from "../web/signals.js";

// Exercise the real controller with a minimal DOM and a controllable provider socket.
test("market switches discard late responses; stale and disconnected signals cannot fill tickets", async (t) => {
  const oldDocument = globalThis.document,
    oldSocket = globalThis.WebSocket;
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        disabled: false,
        children: [],
        replaceChildren() {
          this.children = [];
        },
        append(child) {
          this.children.push(child);
        },
      });
    return elements.get(id);
  };
  globalThis.document = {
    getElementById: element,
    createElement: () => ({ textContent: "" }),
  };
  const sockets = [];
  class Socket {
    constructor() {
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen();
      });
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    history(candles) {
      this.onmessage({
        data: JSON.stringify({ req_id: this.sent.at(-1).req_id, candles }),
      });
    }
  }
  globalThis.WebSocket = Socket;
  let uses = 0;
  const panel = new SignalPanel(() => uses++);
  t.after(() => {
    panel.close();
    globalThis.document = oldDocument;
    globalThis.WebSocket = oldSocket;
  });
  const first = panel.setMarket("R_100");
  await new Promise((r) => setImmediate(r));
  const second = panel.setMarket("R_50");
  await new Promise((r) => setImmediate(r));
  sockets[0].history([]);
  assert.equal(element("signal-market").textContent, "R_50");
  assert.equal(element("use-signal").disabled, true);
  sockets[1].history([]);
  await Promise.all([first, second]);
  assert.match(
    element("signal-reasons").children[0].textContent,
    /400 consecutive/,
  );
  panel.result = { direction: "RISE", expires: Date.now() / 1000 + 60 };
  element("use-signal").onclick();
  assert.equal(uses, 1);
  panel.result.expires = Date.now() / 1000 - 1;
  element("use-signal").onclick();
  assert.equal(uses, 1);
  panel.setHorizon(0);
  assert.equal(element("use-signal").disabled, true);
  assert.match(element("signal-horizon").textContent, /valid trade duration/);
  panel.result = { direction: "RISE", expires: Date.now() / 1000 + 60 };
  sockets[1].close();
  element("use-signal").onclick();
  assert.equal(uses, 1);
  assert.equal(element("signal-direction").textContent, "No trade");
  assert.match(
    element("signal-reasons").children[0].textContent,
    /connection lost/,
  );
});
