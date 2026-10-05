import { DerivSocket, PUBLIC_URL } from "./deriv.js";
import { evaluateMarket } from "./engine.js";
const $ = (id) => document.getElementById(id);
const percent = (value) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;

export class SignalPanel {
  constructor(onUse) {
    this.horizon = 5;
    this.version = 0;
    this.serverTimeOffset = null;
    this.onUse = onUse;
    $("refresh-signal").onclick = () => this.setMarket(this.symbol);
    $("use-signal").onclick = () => {
      const result = this.result;
      if (
        !result ||
        this.serverTimeOffset === null ||
        result.direction === "WAIT" ||
        this.now() >= result.expires ||
        !this.socket?.connected
      )
        return;
      onUse(result.direction, this.horizon);
    };
    this.clock = setInterval(() => {
      if (this.result && this.now() >= this.result.expires && !this.expired) {
        this.expired = true;
        this.render({
          ...this.result,
          direction: "WAIT",
          reasons: [
            "The signal has expired. Waiting for the next closed candle.",
          ],
        });
      }
    }, 1000);
  }
  now() {
    return this.serverTimeOffset === null
      ? NaN
      : Date.now() / 1000 + this.serverTimeOffset;
  }
  setHorizon(horizon) {
    this.horizon = horizon;
    this.result = null;
    if (this.candles && this.socket?.connected) this.analyze();
    else this.showWait("Waiting for market history.");
  }
  showWait(message) {
    this.result = null;
    this.render({ direction: "WAIT", reasons: [message] });
  }
  async setMarket(symbol) {
    if (!symbol) return;
    const version = ++this.version;
    clearTimeout(this.refreshTimer);
    this.socket?.close();
    this.socket = null;
    this.serverTimeOffset = null;
    this.symbol = symbol;
    this.candles = null;
    $("signal-market").textContent = symbol;
    this.showWait("Loading closed candles and checking the model…");
    $("refresh-signal").disabled = true;
    const socket = new DerivSocket({
      onClose: () => {
        if (version !== this.version) return;
        clearTimeout(this.refreshTimer);
        this.showWait(
          "Analysis connection lost. Reconnect before using a signal.",
        );
        $("refresh-signal").disabled = false;
      },
    });
    this.socket = socket;
    try {
      await socket.connect(PUBLIC_URL);
      if (version !== this.version) return;
      const response = await socket.request({ time: 1 });
      if (version !== this.version) return;
      if (!Number.isFinite(response.time) || response.time <= 0)
        throw new Error("Invalid Deriv server time");
      this.serverTimeOffset = response.time - Date.now() / 1000;
      await this.load(version, socket);
    } catch {
      if (version === this.version) {
        socket.close();
        this.showWait(
          "Unable to load analysis data. Try refreshing the engine.",
        );
      }
    } finally {
      if (version === this.version) $("refresh-signal").disabled = false;
    }
  }
  async load(version, socket) {
    try {
      const response = await socket.request({
        ticks_history: this.symbol,
        style: "candles",
        granularity: 60,
        count: 1000,
        end: "latest",
      });
      if (version !== this.version) return;
      this.candles = response.candles;
      this.analyze();
      this.refreshTimer = setTimeout(
        () => void this.load(version, socket),
        (61 - (this.now() % 60)) * 1000,
      );
    } catch {
      if (version !== this.version) return;
      this.showWait("Candle history is unavailable. Refresh to try again.");
    }
  }
  analyze() {
    this.expired = false;
    this.result = evaluateMarket(this.candles, {
      horizon: this.horizon,
      now: this.now(),
    });
    this.render(this.result);
  }
  render(result) {
    const active = result.direction !== "WAIT";
    $("signal-direction").textContent = active
      ? `${result.direction === "RISE" ? "↗ Rise" : "↘ Fall"} setup`
      : "No trade";
    $("signal-direction").className =
      `signal-direction ${active ? result.direction.toLowerCase() : ""}`;
    $("signal-horizon").textContent =
      Number.isInteger(this.horizon) && this.horizon >= 1 && this.horizon <= 60
        ? `${this.horizon}-minute outlook · follows trade duration`
        : "Choose a valid trade duration";
    $("signal-reasons").replaceChildren();
    for (const reason of result.reasons) {
      const li = document.createElement("li");
      li.textContent = reason;
      $("signal-reasons").append(li);
    }
    $("model-score").textContent =
      result.score == null ? "—" : `${Math.round(result.score * 100)} / 100`;
    $("test-accuracy").textContent = percent(result.validation?.accuracy);
    $("test-samples").textContent = result.validation
      ? `${result.validation.wins} correct / ${result.validation.samples} test signals`
      : "Not evaluated yet";
    $("baseline-score").textContent = percent(result.validation?.baseline);
    $("model-rsi").textContent = result.indicators
      ? result.indicators.rsi.toFixed(1)
      : "—";
    $("model-trend").textContent = result.indicators
      ? `${result.indicators.trend} trend · ${result.indicators.volatility.toFixed(3)}% volatility`
      : "Waiting for closed candles";
    $("signal-age").textContent = result.asOf
      ? `${result.candleCount} closed candles · through ${new Date(result.asOf * 1000).toLocaleTimeString()} local time`
      : "No current analysis";
    $("model-drivers").textContent = result.drivers
      ? `Model influences: ${result.drivers.map((d) => `${d.name.toLowerCase()} (${Math.abs(d.value) < 0.01 ? "neutral" : d.value > 0 ? "toward rise" : "toward fall"})`).join(" · ")}.`
      : "";
    $("use-signal").disabled =
      !active ||
      this.serverTimeOffset === null ||
      !this.socket?.connected ||
      this.now() >= result.expires;
  }
  close() {
    this.version++;
    clearInterval(this.clock);
    clearTimeout(this.refreshTimer);
    this.socket?.close();
    this.showWait("Analysis disconnected.");
  }
}
