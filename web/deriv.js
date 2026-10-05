export const PUBLIC_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
const REST_URL = "https://api.derivws.com/trading/v1/options";

/** A single socket owns its requests and subscriptions. Never replay purchases. */
export class DerivSocket {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    timeout = 15000,
    onClose = () => {},
  } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.timeout = timeout;
    this.onClose = onClose;
    this.pending = new Map();
    this.listeners = new Map();
    this.sequence = 0;
  }
  async connect(url) {
    if (this.ws) throw new Error("Connection already started");
    this.ws = new this.WebSocketImpl(url);
    this.ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const pending = this.pending.get(message.req_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.req_id);
        if (message.error)
          pending.reject(
            new Error(message.error.message || "Deriv request failed"),
          );
        else {
          if (pending.listener && message.subscription?.id)
            this.listeners.set(message.subscription.id, pending.listener);
          pending.resolve(message);
        }
      }
      if (!message.error && message.subscription?.id)
        this.listeners.get(message.subscription.id)?.(message);
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Connection timed out"));
        this.close();
      }, this.timeout);
      this.ws.onopen = () => {
        clearTimeout(timer);
        this.heartbeat = setInterval(
          () => this.request({ ping: 1 }).catch(() => this.close()),
          30000,
        );
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Cannot connect to Deriv. Check your network and try again.",
          ),
        );
        this.close();
      };
      this.ws.onclose = () => {
        clearTimeout(timer);
        clearInterval(this.heartbeat);
        const error = new Error("Connection closed. Reconnect to Deriv.");
        reject(error);
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(
            request.isPurchase
              ? new Error(
                  "Purchase status unknown. Check your Deriv account before trading again.",
                )
              : error,
          );
        }
        this.pending.clear();
        this.listeners.clear();
        this.onClose();
      };
    });
  }
  get connected() {
    return this.ws?.readyState === 1;
  }
  request(payload, listener) {
    if (!this.connected)
      return Promise.reject(new Error("Connect to Deriv first"));
    const req_id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(
          new Error(
            payload.buy
              ? "Purchase status unknown. Check your Deriv account before trading again."
              : "Deriv request timed out. Please reconnect.",
          ),
        );
        // Closing also releases any subscription whose acknowledgement was lost.
        this.close();
      }, this.timeout);
      this.pending.set(req_id, {
        resolve,
        reject,
        timer,
        listener,
        isPurchase: Boolean(payload.buy),
      });
      try {
        this.ws.send(JSON.stringify({ ...payload, req_id }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(req_id);
        reject(new Error("Unable to send request"));
        this.close();
      }
    });
  }
  async forget(id) {
    this.listeners.delete(id);
    if (this.connected && id) await this.request({ forget: id });
  }
  close() {
    clearInterval(this.heartbeat);
    this.ws?.close();
  }
}

export async function accountRequest(
  path,
  appId,
  token,
  method = "GET",
  fetchImpl = fetch,
) {
  const response = await fetchImpl(`${REST_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Deriv-App-ID": appId },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
    credentials: "omit",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.errors?.[0]?.message || `Deriv returned ${response.status}`,
    );
  return body.data;
}

export function demoSocketUrl(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "wss:" ||
    parsed.host !== "api.derivws.com" ||
    parsed.pathname !== "/trading/v1/options/ws/demo" ||
    !parsed.searchParams.get("otp") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Deriv did not return a valid demo account connection");
  }
  return parsed.href;
}

export function tradeParameters({
  symbol,
  amount,
  duration,
  direction,
  currency,
}) {
  if (!symbol || !currency || !["CALL", "PUT"].includes(direction))
    throw new Error("Select a market and direction");
  if (
    !Number.isFinite(amount) ||
    amount < 0.35 ||
    amount > 100 ||
    Math.abs(Math.round(amount * 100) - amount * 100) > 1e-8
  )
    throw new Error(
      "Enter a stake from 0.35 to 100, with at most two decimal places",
    );
  if (!Number.isInteger(duration) || duration < 1 || duration > 60)
    throw new Error("Duration must be 1–60 minutes");
  return {
    proposal: 1,
    amount,
    basis: "stake",
    contract_type: direction,
    currency,
    duration,
    duration_unit: "m",
    underlying_symbol: symbol,
  };
}
