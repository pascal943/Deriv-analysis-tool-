import test from "node:test";
import assert from "node:assert/strict";
import { SignalPanel } from "../web/signals.js";

// Exercise the real controller with a minimal DOM and a controllable provider socket.
function harness(t, time = () => Date.now() / 1000) {
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
      const request = JSON.parse(raw);
      this.sent.push(request);
      if (request.time)
        queueMicrotask(() =>
          this.onmessage({
            data: JSON.stringify({ req_id: request.req_id, time: time() }),
          }),
        );
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
  return { panel, element, sockets, uses: () => uses };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("market switches discard late responses; stale and disconnected signals cannot fill tickets", async (t) => {
  const { panel, element, sockets, uses } = harness(t);
  const first = panel.setMarket("R_100");
  await flush();
  const second = panel.setMarket("R_50");
  await flush();
  sockets[0].history([]);
  assert.equal(element("signal-market").textContent, "R_50");
  assert.equal(element("use-signal").disabled, true);
  sockets[1].history([]);
  await Promise.all([first, second]);
  assert.match(
    element("signal-reasons").children[0].textContent,
    /400 consecutive/,
  );
  panel.result = { direction: "RISE", expires: panel.now() + 60 };
  element("use-signal").onclick();
  assert.equal(uses(), 1);
  panel.result.expires = panel.now() - 1;
  element("use-signal").onclick();
  assert.equal(uses(), 1);
  panel.setHorizon(0);
  assert.equal(element("use-signal").disabled, true);
  assert.match(element("signal-horizon").textContent, /valid trade duration/);
  panel.result = { direction: "RISE", expires: panel.now() + 60 };
  sockets[1].close();
  element("use-signal").onclick();
  assert.equal(uses(), 1);
  assert.equal(element("signal-direction").textContent, "No trade");
  assert.match(
    element("signal-reasons").children[0].textContent,
    /connection lost/,
  );
});

for (const skew of [-3600, 3600]) {
  test(`Deriv clock drives candle analysis and every expiry guard with local skew ${skew}s`, async (t) => {
    const boundary = 1800000000,
      serverTime = boundary + 45;
    let localTime = (serverTime + skew) * 1000;
    t.mock.method(Date, "now", () => localTime);
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { panel, element, sockets, uses } = harness(t, () => serverTime);
    const pending = panel.setMarket("R_100");
    await flush();
    assert.equal(sockets[0].sent[0].time, 1);
    assert.equal(sockets[0].sent[1].ticks_history, "R_100");
    assert.equal(panel.serverTimeOffset, -skew);
    assert.equal(panel.now(), serverTime);
    const candles = Array.from({ length: 401 }, (_, i) => ({
      epoch: boundary - (400 - i) * 60,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
    }));
    sockets[0].history(candles);
    await pending;
    assert.equal(
      panel.result.candleCount,
      400,
      "Exclude the incomplete server candle",
    );
    assert.equal(
      panel.result.asOf,
      boundary,
      "Analyze fresh candles despite local clock skew",
    );
    assert.equal(
      panel.refreshTimer._idleTimeout,
      16000,
      "Refresh follows the server minute boundary",
    );
    panel.result = { direction: "RISE", reasons: [], expires: boundary + 60 };
    panel.render(panel.result);
    assert.equal(element("use-signal").disabled, false);
    element("use-signal").onclick();
    assert.equal(uses(), 1);
    localTime += 15000;
    element("use-signal").onclick();
    assert.equal(uses(), 1, "Click cannot use a signal after server expiry");
    panel.render(panel.result);
    assert.equal(
      element("use-signal").disabled,
      true,
      "Render uses server expiry",
    );
    t.mock.timers.tick(1000);
    assert.equal(element("signal-direction").textContent, "No trade");
    assert.match(element("signal-reasons").children[0].textContent, /expired/);
  });
}

test("invalid Deriv time leaves analysis unavailable instead of using the local clock", async (t) => {
  const { panel, sockets, element } = harness(t, () => undefined);
  await panel.setMarket("R_100");
  assert.equal(panel.serverTimeOffset, null);
  assert.equal(panel.result, null);
  assert.equal(
    sockets[0].sent.length,
    1,
    "No candle request before valid clock synchronization",
  );
  assert.equal(element("use-signal").disabled, true);
  assert.equal(sockets[0].readyState, 3);
});
