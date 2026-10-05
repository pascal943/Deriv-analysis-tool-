# Orbit web workspace

## Run locally

Requires Node.js 24 or newer. The browser app and development server have no npm dependencies.

```bash
npm start
```

Open `http://localhost:3000`. Set `PORT` to change the port. The server binds to `127.0.0.1` by default; set `HOST=0.0.0.0` explicitly if you need LAN access. Stop with Ctrl+C.

```bash
npm test
```

The existing Python analysis utilities are independent of this web app.

## Features

- Live prices and tick history from Deriv's public Options WebSocket API.
- Available market selection and 60, 120, or 300 tick charts.
- Demo account linking with a registered PAT application ID and Personal Access Token.
- Subscribed account balance, Rise/Fall quotes, explicit purchase confirmation, and contract updates.
- Quotes expire locally after 20 seconds and are invalidated when inputs change.
- Connection errors, timeouts, explicit reconnection, and subscription cleanup.

## Link your Deriv account

1. Create a demo Options account on Deriv.
2. Follow [Deriv's authentication guide](https://developers.deriv.com/docs/intro/authentication/) to register a PAT application and create a Personal Access Token with the `trade` scope.
3. Click **Connect Deriv** and enter your application ID and token in the app. Do not put tokens in source files, URLs, or chat.
4. The app lists your accounts, selects the first active demo account, and obtains its one-time WebSocket URL. It accepts only Deriv's demo WebSocket endpoint.
5. Select a market, direction, stake, and duration. Choose **Review trade**, inspect the provider's contract description and quote, then **Confirm demo trade**.

The token is sent directly from the browser to Deriv via HTTPS. It is never written to browser storage or the development server. The input is cleared on submission/closing, and the local token reference is cleared after connection. Refreshing or disconnecting requires another login. Production public onboarding should use Deriv's OAuth flow and a registered redirect URL; this initial personal workspace uses manual PAT linking.

## Limits of this version

- Demo trading only. No real account purchases or automated strategies.
- Rise/Fall with 1–60 minute duration and a stake of 0.35–100 in the account currency. Deriv determines supported contracts and actual minimums for each market; unsupported requests show the provider's error.
- Activity shows contracts purchased in the current connected session. Refreshing/reconnecting clears that list; it does not cancel contracts. Check Deriv for complete account history and existing positions.
- If a purchase response is lost, the app does not retry it. Check your Deriv account before placing another trade.
- The chart change/high/low metrics describe displayed ticks, not daily market statistics.
- `server.mjs` serves only the web assets and is intended for local development. Deploy the static `web/` assets with HTTPS and equivalent security headers for hosting.

## API references

Implemented against the current documentation inspected on 2026-10-05:

- [Public market connection](https://developers.deriv.com/docs/options/ws-public/)
- [Account list](https://developers.deriv.com/docs/options/get-accounts/)
- [Account WebSocket OTP](https://developers.deriv.com/docs/options/websocket/)
- [Proposals](https://developers.deriv.com/docs/trading/proposal/) and [purchases](https://developers.deriv.com/docs/trading/buy/)

Public market data has been verified against Deriv. Authentication and trading UI have been tested with synthetic responses; provider-authenticated demo execution still needs a registered app/token.

## Market intelligence engine

The **Orbit Intelligence** panel adds an experimental, locally trained model. It uses Deriv's last 1,000 one-minute candles (usually 999 closed candles plus an excluded incomplete candle). Market changes reset the analysis; chart tick-range changes do not. The analysis connection synchronizes with Deriv server time. Candle history refreshes just after each server minute boundary, and candle freshness and signal expiry use that same adjusted clock. The forecast horizon follows the trade ticket's duration.

### Model and evidence

- A regularized logistic-regression classifier is fitted in the browser. It requires no AI subscription, provider key, or external inference service. It retrains on each new history snapshot; it does not retain a cross-session model.
- Six inputs summarize short/long EMA trend, five-candle momentum, RSI balance, position in the recent price range, and candle body pressure. Features use a trailing 60-candle window; RSI uses simple average gains/losses over 14 changes. Displayed volatility is the standard deviation of 20 one-minute log returns, not annualized volatility.
- The oldest 65% of the continuous window is used for training. Training labels must end before that boundary. Normalization is fitted only to training examples. The remaining data is held out chronologically; evaluation entry points are separated by the forecast horizon so their future outcome windows do not overlap.
- Training excludes unchanged outcomes. Test ties count as misses. Test statistics cover only candidates that pass the same score, trend, and RSI filters used for a current signal.
- A candidate needs a raw Rise score of at least 0.60 (or at most 0.40 for Fall), matching short/long trend, and RSI below 75 for Rise or above 25 for Fall. The displayed score is **not a calibrated win probability**.
- An actionable setup additionally needs at least 30 qualifying test signals, an approximate 95% Wilson lower bound above 50%, and a hit rate more than three percentage points above a fixed-direction baseline. The baseline's direction is chosen from the training labels and evaluated on the same test signals.
- Missing, malformed, out-of-order, stale, flat, or insufficient data produces **No trade**. A gap resets the continuous training window. At least 400 consecutive closed candles and 200 labeled training examples are required, with at least 20 examples of each direction.
- Signals expire at the next minute boundary. **Use direction in ticket** only copies Rise/Fall into the manual ticket. It never requests or purchases a contract.

### Interpretation and limitations

This is an experimental baseline, not a proven prediction service. It can—and often should—show No trade. Longer horizons may have too few non-overlapping test signals to pass validation. Refreshing does not create independent evidence: adjacent rolling windows overlap. Serial dependence, multiple market/horizon selection, and repeated evaluations limit confidence-interval interpretation. Thresholds and hyperparameters are fixed engineering defaults, not values optimized or established by an independent study.

The test measures candle-close direction over a horizon, not actual Deriv contract profit. A forecast starts at the last closed candle; a later ticket has a different entry/expiry. Payouts, price changes between signal and entry, execution, and fees are not modeled. Directional accuracy above 50% does not by itself imply positive expected returns. Establishing predictive performance would require a larger independent historical study and forward demo tracking.

Validation methodology follows the principle of testing time-series models on later observations; see [scikit-learn's time-series cross-validation guidance](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-of-time-series-data). Candle data uses [Deriv's ticks-history API](https://developers.deriv.com/docs/data/ticks-history/).
