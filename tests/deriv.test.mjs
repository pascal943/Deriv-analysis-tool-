import test from "node:test";
import assert from "node:assert/strict";
import {
  DerivSocket,
  demoSocketUrl,
  tradeParameters,
  accountRequest,
} from "../web/deriv.js";

class FakeWebSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen();
    });
  }
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
  reply(message) {
    this.onmessage({ data: JSON.stringify(message) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
async function connection(t, timeout = 1000) {
  const client = new DerivSocket({ WebSocketImpl: FakeWebSocket, timeout });
  await client.connect("wss://example.test");
  t.after(() => client.close());
  return client;
}
test("correlates out-of-order responses and rejects API errors", async (t) => {
  const client = await connection(t);
  const first = client.request({ ping: 1 });
  const second = client.request({ balance: 1 });
  client.ws.reply({ req_id: 2, balance: { balance: 100 } });
  client.ws.reply({ req_id: 1, ping: "pong" });
  assert.equal((await second).balance.balance, 100);
  assert.equal((await first).ping, "pong");
  const error = client.request({ proposal: 1 });
  client.ws.reply({ req_id: 3, error: { message: "Invalid contract" } });
  await assert.rejects(error, /Invalid contract/);
  assert.equal(client.pending.size, 0);
});
test("subscription receives initial and subsequent updates; forget stops callbacks", async (t) => {
  const client = await connection(t);
  let updates = 0;
  const request = client.request(
    { ticks: "R_100", subscribe: 1 },
    () => updates++,
  );
  client.ws.reply({
    req_id: 1,
    subscription: { id: "ticks-1" },
    tick: { quote: 10 },
  });
  await request;
  client.ws.reply({ subscription: { id: "ticks-1" }, tick: { quote: 11 } });
  const forget = client.forget("ticks-1");
  client.ws.reply({ req_id: 2, forget: 1 });
  await forget;
  client.ws.reply({ subscription: { id: "ticks-1" }, tick: { quote: 12 } });
  assert.equal(updates, 2);
});
test("disconnect rejects pending requests and releases listeners", async (t) => {
  const client = await connection(t);
  const request = client.request({ balance: 1 });
  client.close();
  await assert.rejects(request, /Connection closed/);
  assert.equal(client.pending.size, 0);
  assert.equal(client.listeners.size, 0);
  await assert.rejects(client.request({ ping: 1 }), /Connect to Deriv first/);
});
test("purchase timeout closes the connection and never retries a buy", async (t) => {
  const client = await connection(t, 10);
  await assert.rejects(
    client.request({ buy: "proposal-id", price: 10 }),
    /Purchase status unknown/,
  );
  assert.equal(client.ws.sent.length, 1);
  assert.equal(client.connected, false);
});
test("only accepts the exact Deriv demo WebSocket endpoint", () => {
  const valid =
    "wss://api.derivws.com/trading/v1/options/ws/demo?otp=synthetic";
  assert.equal(demoSocketUrl(valid), valid);
  for (const url of [
    valid.replace("/demo", "/real"),
    valid.replace("wss:", "ws:"),
    valid.replace("api.derivws.com", "api.derivws.com.attacker.test"),
    valid.split("?")[0],
    valid.replace("api.derivws.com", "user@api.derivws.com"),
  ])
    assert.throws(() => demoSocketUrl(url));
});
test("validates monetary and duration boundaries before generating a proposal", () => {
  const input = {
    symbol: "R_100",
    amount: 10,
    duration: 5,
    direction: "CALL",
    currency: "USD",
  };
  assert.equal(tradeParameters(input).underlying_symbol, "R_100");
  assert.equal(tradeParameters({ ...input, amount: 0.57 }).amount, 0.57);
  for (const amount of [NaN, Infinity, -1, 0, 0.34, 100.01, 1.001])
    assert.throws(() => tradeParameters({ ...input, amount }));
  for (const duration of [0, 1.5, 61, NaN])
    assert.throws(() => tradeParameters({ ...input, duration }));
  assert.throws(() => tradeParameters({ ...input, direction: "BUY" }));
});
test("REST authentication uses headers and reports provider errors", async () => {
  const fetchMock = async (url, options) => {
    assert.equal(url, "https://api.derivws.com/trading/v1/options/accounts");
    assert.equal(options.headers.Authorization, "Bearer synthetic-token");
    assert.equal(options.headers["Deriv-App-ID"], "test-app");
    assert.equal(options.credentials, "omit");
    return {
      ok: true,
      json: async () => ({ data: [{ account_type: "demo" }] }),
    };
  };
  assert.equal(
    (
      await accountRequest(
        "/accounts",
        "test-app",
        "synthetic-token",
        "GET",
        fetchMock,
      )
    )[0].account_type,
    "demo",
  );
  await assert.rejects(
    accountRequest(
      "/accounts",
      "test-app",
      "synthetic-token",
      "GET",
      async () => ({
        ok: false,
        json: async () => ({ errors: [{ message: "Invalid token" }] }),
      }),
    ),
    /Invalid token/,
  );
});

test("purchase interrupted by disconnect reports an unknown outcome", async (t) => {
  const client = await connection(t);
  const purchase = client.request({ buy: "proposal-id", price: 10 });
  client.close();
  await assert.rejects(purchase, /Purchase status unknown/);
  assert.equal(client.ws.sent.length, 1);
});
