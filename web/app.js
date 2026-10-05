import { SignalPanel } from "./signals.js";
import {
  DerivSocket,
  PUBLIC_URL,
  accountRequest,
  demoSocketUrl,
  tradeParameters,
} from "./deriv.js";
const $ = (id) => document.getElementById(id);
const state = {
  symbols: [],
  symbol: "R_100",
  points: [],
  count: 120,
  direction: "CALL",
  marketVersion: 0,
  accountVersion: 0,
  trades: new Map(),
};
let marketSocket,
  accountSocket,
  tickSubscription,
  quote,
  quoteTimer,
  buying = false;
const signalPanel = new SignalPanel((direction) => {
  state.direction = direction === "RISE" ? "CALL" : "PUT";
  invalidateQuote();
  document
    .querySelectorAll("[data-direction]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        button.dataset.direction === state.direction,
      ),
    );
  $("trade-form").scrollIntoView({ behavior: "smooth", block: "center" });
  notify(
    "Signal direction copied to the ticket. Review a fresh quote before confirming a demo trade.",
  );
});
$("duration").addEventListener("input", () =>
  signalPanel.setHorizon(Number($("duration").value)),
);
const money = (value, currency = state.account?.currency || "USD") =>
  `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const price = (value) =>
  Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
function notify(message) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
function invalidateQuote() {
  quote = null;
  clearTimeout(quoteTimer);
  $("buy-button").disabled = true;
  $("payout").textContent = "Get a quote";
}
function updateTrading() {
  $("quote-button").disabled =
    !accountSocket?.connected || !state.account || buying;
}
function clearAccount() {
  state.accountVersion++;
  state.account = null;
  invalidateQuote();
  $("quote-dialog").close();
  $("balance").textContent = "— USD";
  $("account-label").textContent = "Connect your demo account";
  $("connect").textContent = "Connect Deriv ↗";
  $("stake-currency").textContent = "USD";
  $("trade-note").textContent =
    "Connect a demo account to start trading with virtual funds.";
  for (const row of state.trades.values())
    if (row.status === "Open") row.status = "Check Deriv";
  renderTrades();
  updateTrading();
}
function disconnect() {
  const socket = accountSocket;
  accountSocket = null;
  socket?.close();
  clearAccount();
}
function showConnection() {
  if (state.account) {
    disconnect();
    notify("Your account has been disconnected.");
    return;
  }
  $("connection-error").textContent = "";
  $("connection-dialog").showModal();
}
for (const id of ["connect", "sidebar-connect", "learn-connect"])
  $(id).onclick = showConnection;
$("close-connect").onclick = () => $("connection-dialog").close();
$("connection-dialog").addEventListener("close", () => {
  $("token").value = "";
  if (!state.account) state.accountVersion++;
});
$("close-quote").onclick = () => $("quote-dialog").close();
$("quote-dialog").addEventListener("close", () => {
  // A queued close event from the previous quote must not invalidate a new dialog.
  if (!$("quote-dialog").open) invalidateQuote();
});
$("connection-form").onsubmit = async (event) => {
  event.preventDefault();
  const appId = $("app-id").value.trim();
  let token = $("token").value.trim();
  $("token").value = "";
  if (!appId || !token) return;
  const version = ++state.accountVersion;
  $("link-account").disabled = true;
  $("link-account").textContent = "Connecting…";
  $("connection-error").textContent = "";
  let socket;
  try {
    const accounts = await accountRequest("/accounts", appId, token);
    if (version !== state.accountVersion) return;
    const account = accounts.find(
      (item) => item.account_type === "demo" && item.status === "active",
    );
    if (!account)
      throw new Error(
        "No active demo Options account found. Create one on Deriv, then try again.",
      );
    const data = await accountRequest(
      `/accounts/${encodeURIComponent(account.account_id)}/otp`,
      appId,
      token,
      "POST",
    );
    token = "";
    if (version !== state.accountVersion) return;
    socket = new DerivSocket({
      onClose: () => {
        if (accountSocket === socket) {
          accountSocket = null;
          clearAccount();
          notify(
            "Account connection lost. Reconnect to see your balance. Check Deriv for any open contracts.",
          );
        }
      },
    });
    await socket.connect(demoSocketUrl(data.url));
    if (version !== state.accountVersion) {
      socket.close();
      return;
    }
    accountSocket = socket;
    await socket.request({ balance: 1, subscribe: 1 }, (message) => {
      if (accountSocket === socket)
        $("balance").textContent = money(
          message.balance.balance,
          message.balance.currency,
        );
    });
    if (accountSocket !== socket || version !== state.accountVersion) {
      socket.close();
      return;
    }
    state.account = account;
    state.trades.clear();
    renderTrades();
    $("account-label").textContent = `${account.account_id} · Demo account`;
    $("stake-currency").textContent = account.currency;
    $("connect").textContent = "Disconnect account";
    $("trade-note").textContent =
      "Virtual funds only. Review your quote before confirming.";
    $("connection-dialog").close();
    notify("Demo account connected. You can now request a trade quote.");
    updateTrading();
  } catch (error) {
    socket?.close();
    $("connection-error").textContent = error.message;
  } finally {
    token = "";
    $("link-account").disabled = false;
    $("link-account").textContent = "Connect demo account →";
  }
};

async function connectMarket() {
  $("feed-status").textContent = "Connecting…";
  $("feed-status").classList.remove("offline");
  const socket = new DerivSocket({
    onClose: () => {
      if (marketSocket !== socket) return;
      $("feed-status").textContent = "Market offline";
      $("feed-status").classList.add("offline");
      $("chart-source").textContent = "Disconnected · prices may be stale";
      notify(
        "Market connection lost. Use “Reconnect market data” to try again.",
      );
      $("reconnect-market").hidden = false;
    },
  });
  marketSocket = socket;
  try {
    await socket.connect(PUBLIC_URL);
    const result = await socket.request({ active_symbols: "brief" });
    if (marketSocket !== socket) return;
    state.symbols = result.active_symbols.filter(
      (s) => s.exchange_is_open && !s.is_trading_suspended,
    );
    const select = $("market");
    select.replaceChildren();
    state.symbols.sort((a, b) =>
      a.underlying_symbol_name.localeCompare(b.underlying_symbol_name),
    );
    for (const symbol of state.symbols) {
      const option = document.createElement("option");
      option.value = symbol.underlying_symbol;
      option.textContent = symbol.underlying_symbol_name;
      select.append(option);
    }
    if (!state.symbols.some((s) => s.underlying_symbol === state.symbol))
      state.symbol = state.symbols[0]?.underlying_symbol;
    if (!state.symbol) throw new Error("No open markets returned by Deriv");
    select.value = state.symbol;
    $("feed-status").textContent = "Market connected";
    $("reconnect-market").hidden = true;
    notify("");
    void signalPanel.setMarket(state.symbol);
    await selectMarket();
  } catch (error) {
    if (marketSocket === socket) {
      notify(error.message);
      socket.close();
    }
  }
}
// Reconnection is explicit; account authentication and purchases are never replayed.
const reconnect = document.createElement("button");
reconnect.id = "reconnect-market";
reconnect.className = "button";
reconnect.textContent = "Reconnect market data";
reconnect.hidden = true;
$("notice").after(reconnect);
reconnect.onclick = () => {
  reconnect.hidden = true;
  tickSubscription = null;
  void connectMarket();
};
async function selectMarket() {
  const version = ++state.marketVersion;
  invalidateQuote();
  const socket = marketSocket,
    symbol = state.symbol;
  state.points = [];
  drawChart();
  const details = state.symbols.find((s) => s.underlying_symbol === symbol);
  $("market-name").textContent = details?.underlying_symbol_name || symbol;
  $("market-symbol").textContent =
    `${symbol} · ${(details?.market || "").replaceAll("_", " ")}`;
  $("chart-source").textContent = "Loading Deriv ticks…";
  const old = tickSubscription;
  tickSubscription = null;
  try {
    if (old) await socket.forget(old);
    if (version !== state.marketVersion) return;
    const history = await socket.request({
      ticks_history: symbol,
      count: state.count,
      end: "latest",
      style: "ticks",
    });
    if (version !== state.marketVersion) return;
    state.points = history.history.times.map((time, i) => ({
      time,
      price: Number(history.history.prices[i]),
    }));
    drawChart();
    const result = await socket.request(
      { ticks: symbol, subscribe: 1 },
      (message) => {
        if (version !== state.marketVersion || !message.tick) return;
        const tick = message.tick;
        const point = { time: tick.epoch, price: Number(tick.quote) };
        if (state.points.at(-1)?.time === point.time)
          state.points[state.points.length - 1] = point;
        else state.points.push(point);
        state.points = state.points.slice(-state.count);
        $("chart-source").textContent = "Live ticks · Deriv";
        $("last-tick").textContent =
          `${new Date(point.time * 1000).toLocaleTimeString()} · local time`;
        drawChart();
      },
    );
    if (version !== state.marketVersion) {
      await socket.forget(result.subscription?.id);
      return;
    }
    tickSubscription = result.subscription?.id;
  } catch (error) {
    if (version === state.marketVersion) {
      $("chart-source").textContent = "Market data unavailable";
      notify(error.message);
    }
  }
}
$("market").onchange = () => {
  state.symbol = $("market").value;
  void signalPanel.setMarket(state.symbol);
  void selectMarket();
};
for (const button of document.querySelectorAll("[data-count]"))
  button.onclick = () => {
    state.count = Number(button.dataset.count);
    document
      .querySelectorAll("[data-count]")
      .forEach((b) => b.classList.toggle("selected", b === button));
    void selectMarket();
  };
function drawChart() {
  const points = state.points.filter((p) => Number.isFinite(p.price));
  if (points.length < 2) {
    $("chart").setAttribute("viewBox", "0 0 900 320");
    $("last-tick").textContent = "—";
    $("chart").innerHTML =
      '<text x="450" y="160" text-anchor="middle">Waiting for market data…</text>';
    for (const id of ["spot-price", "range-high", "range-low"])
      $(id).textContent = "—";
    $("price-change").textContent = "Waiting for market data";
    return;
  }
  const values = points.map((p) => p.price),
    high = Math.max(...values),
    low = Math.min(...values),
    last = values.at(-1);
  const padding = (high - low || high * 0.001 || 1) * 0.2,
    min = low - padding,
    max = high + padding;
  const width = Math.max(320, $("chart").clientWidth),
    end = width - 75;
  $("chart").setAttribute("viewBox", `0 0 ${width} 320`);
  const x = (i) => 12 + (i / (points.length - 1)) * (end - 12),
    y = (v) => 275 - ((v - min) / (max - min)) * 255;
  const path = points
    .map(
      (p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.price).toFixed(2)}`,
    )
    .join(" ");
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    grid += `<line class="chart-grid" x1="10" x2="${end + 8}" y1="${y(v)}" y2="${y(v)}"/><text x="${end + 16}" y="${y(v) + 4}">${price(v)}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const index = Math.floor(((points.length - 1) * i) / 4);
    grid += `<text x="${x(index)}" y="309" text-anchor="${i === 0 ? "start" : "middle"}">${new Date(points[index].time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>`;
  }
  $("chart").innerHTML =
    `<defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#83b593" stop-opacity=".25"/><stop offset="100%" stop-color="#83b593" stop-opacity="0"/></linearGradient></defs>${grid}<path class="chart-area" d="${path} L${end},280 L12,280 Z"/><path class="price-line" d="${path}"/><line class="last-guide" x1="10" x2="${end + 8}" y1="${y(last)}" y2="${y(last)}"/><circle cx="${end}" cy="${y(last)}" r="3" fill="#368966"/>`;
  $("spot-price").textContent = price(last);
  $("range-high").textContent = price(high);
  $("range-low").textContent = price(low);
  const change = ((last - values[0]) / values[0]) * 100;
  $("price-change").textContent =
    `${change >= 0 ? "↗ +" : "↘ "}${change.toFixed(2)}% over visible ticks`;
  $("price-change").className = change >= 0 ? "positive" : "negative";
}
for (const button of document.querySelectorAll("[data-direction]"))
  button.onclick = () => {
    state.direction = button.dataset.direction;
    invalidateQuote();
    document
      .querySelectorAll("[data-direction]")
      .forEach((b) => b.classList.toggle("selected", b === button));
  };
$("trade-form").addEventListener("input", invalidateQuote);
function currentParameters() {
  return tradeParameters({
    symbol: state.symbol,
    amount: Number($("stake").value),
    duration: Number($("duration").value),
    direction: state.direction,
    currency: state.account?.currency,
  });
}
$("trade-form").onsubmit = async (event) => {
  event.preventDefault();
  invalidateQuote();
  if (!state.account || !accountSocket?.connected || buying) return;
  const socket = accountSocket,
    version = state.accountVersion;
  $("quote-button").disabled = true;
  try {
    const parameters = currentParameters(),
      signature = JSON.stringify(parameters);
    const result = await socket.request(parameters);
    if (
      socket !== accountSocket ||
      version !== state.accountVersion ||
      signature !== JSON.stringify(currentParameters())
    )
      return;
    const proposal = result.proposal;
    if (
      !proposal?.id ||
      !Number.isFinite(Number(proposal.ask_price)) ||
      Number(proposal.ask_price) <= 0 ||
      Number(proposal.ask_price) > parameters.amount
    )
      throw new Error("Deriv returned an invalid quote");
    quote = {
      ...proposal,
      expires: Date.now() + 20000,
      socket,
      version,
      symbol: state.symbol,
    };
    $("quote-description").textContent = proposal.longcode;
    $("quote-details").textContent =
      `Stake: ${money(proposal.ask_price)} · Potential payout: ${money(proposal.payout)}`;
    $("payout").textContent = money(proposal.payout);
    $("buy-button").disabled = false;
    $("buy-button").textContent = "Confirm demo trade";
    $("quote-dialog").showModal();
    quoteTimer = setTimeout(() => {
      invalidateQuote();
      $("buy-button").textContent = "Quote expired — request another";
    }, 20000);
  } catch (error) {
    notify(error.message);
  } finally {
    updateTrading();
  }
};
$("buy-button").onclick = async () => {
  const purchase = quote;
  if (
    !purchase ||
    buying ||
    Date.now() >= purchase.expires ||
    purchase.socket !== accountSocket ||
    purchase.version !== state.accountVersion ||
    state.account?.account_type !== "demo"
  ) {
    invalidateQuote();
    return;
  }
  buying = true;
  invalidateQuote();
  $("quote-dialog").close();
  updateTrading();
  const socket = accountSocket,
    version = state.accountVersion;
  try {
    const result = await socket.request({
      buy: purchase.id,
      price: Number(purchase.ask_price),
    });
    if (socket !== accountSocket || version !== state.accountVersion) return;
    const trade = result.buy;
    state.trades.set(trade.contract_id, {
      symbol: purchase.symbol,
      id: trade.contract_id,
      stake: trade.buy_price,
      currency: state.account.currency,
      status: "Open",
      profit: null,
    });
    renderTrades();
    notify(
      `Demo contract ${trade.contract_id} purchased. Watching its status.`,
    );
    try {
      await socket.request(
        {
          proposal_open_contract: 1,
          contract_id: trade.contract_id,
          subscribe: 1,
        },
        (message) => {
          if (socket !== accountSocket) return;
          const contract = message.proposal_open_contract,
            row = state.trades.get(trade.contract_id);
          if (!row || !contract) return;
          row.status = contract.is_sold ? contract.status : "Open";
          row.profit = contract.profit;
          renderTrades();
          if (contract.is_sold && message.subscription?.id)
            socket.forget(message.subscription.id).catch(() => {});
        },
      );
    } catch {
      notify(
        `Demo contract ${trade.contract_id} was purchased, but updates are unavailable. Check its status in Deriv.`,
      );
    }
  } catch (error) {
    notify(error.message);
  } finally {
    buying = false;
    updateTrading();
  }
};
function renderTrades() {
  $("trades").replaceChildren();
  $("trade-count").textContent = state.trades.size;
  $("empty-trades").hidden = state.trades.size > 0;
  for (const row of [...state.trades.values()].reverse()) {
    const tr = document.createElement("tr");
    for (const value of [
      row.symbol,
      row.id,
      money(row.stake, row.currency),
      row.status,
      row.profit == null ? "—" : money(row.profit, row.currency),
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    $("trades").append(tr);
  }
}
window.addEventListener("pagehide", () => {
  marketSocket?.close();
  signalPanel.close();
  disconnect();
});
window.addEventListener("resize", drawChart);
void connectMarket();
