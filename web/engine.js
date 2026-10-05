// Experimental, local supervised model. Scores are not calibrated win probabilities.
export const FEATURE_NAMES = [
  "Short trend",
  "Long trend",
  "Momentum",
  "RSI balance",
  "Range position",
  "Candle pressure",
];
export const LOOKBACK = 60;
const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value) => Math.max(-8, Math.min(8, value));
const sigmoid = (value) =>
  1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const ema = (values, period) =>
  values.reduce(
    (previous, value) => previous + (2 / (period + 1)) * (value - previous),
    values[0],
  );

export function featuresAt(candles, index) {
  const window = candles.slice(index - LOOKBACK + 1, index + 1);
  const closes = window.map((c) => c.close);
  const last = window.at(-1),
    returns = closes.slice(1).map((v, i) => Math.log(v / closes[i]));
  const ranges = window
    .slice(1)
    .map((c, i) =>
      Math.max(
        c.high - c.low,
        Math.abs(c.high - window[i].close),
        Math.abs(c.low - window[i].close),
      ),
    );
  const atr = mean(ranges.slice(-14));
  const scale = Math.max(atr, last.close * 1e-8);
  const changes = closes
    .slice(-15)
    .slice(1)
    .map((v, i) => v - closes[closes.length - 15 + i]);
  const gains = mean(changes.map((v) => Math.max(0, v))),
    losses = mean(changes.map((v) => Math.max(0, -v)));
  const rsi = gains + losses === 0 ? 50 : (100 * gains) / (gains + losses);
  const high = Math.max(...window.slice(-20).map((c) => c.high)),
    low = Math.min(...window.slice(-20).map((c) => c.low));
  const fast = ema(closes, 8),
    medium = ema(closes, 21),
    slow = ema(closes, 55);
  const recent = returns.slice(-20),
    average = mean(recent);
  return {
    x: [
      (fast - medium) / scale,
      (medium - slow) / scale,
      (last.close - closes.at(-6)) / scale,
      (rsi - 50) / 50,
      high === low ? 0 : (2 * (last.close - low)) / (high - low) - 1,
      (last.close - last.open) / scale,
    ].map(clamp),
    rsi,
    atr,
    volatility: Math.sqrt(mean(recent.map((v) => (v - average) ** 2))) * 100,
    trend:
      fast > medium && medium > slow
        ? "Rising"
        : fast < medium && medium < slow
          ? "Falling"
          : "Mixed",
  };
}

// Fit and normalize only on rows whose outcomes end before the test boundary.
export function prepareDataset(candles, horizon) {
  const split = Math.floor(candles.length * 0.65),
    training = [],
    validation = [];
  const rowAt = (index) => ({
    index,
    targetIndex: index + horizon,
    ...featuresAt(candles, index),
    change: candles[index + horizon].close - candles[index].close,
  });
  for (let i = LOOKBACK - 1; i + horizon < split; i++) {
    const row = rowAt(i);
    if (row.change !== 0) training.push({ ...row, y: row.change > 0 ? 1 : 0 });
  }
  // Non-overlapping forecast outcomes reduce serial dependence in the test set.
  for (let i = split; i + horizon < candles.length; i += horizon)
    validation.push(rowAt(i));
  return { training, validation, split };
}
export function fitModel(rows) {
  const means = FEATURE_NAMES.map((_, j) => mean(rows.map((row) => row.x[j])));
  const scales = means.map((m, j) =>
    Math.max(1e-6, Math.sqrt(mean(rows.map((row) => (row.x[j] - m) ** 2)))),
  );
  const normalize = (x) => x.map((v, j) => clamp((v - means[j]) / scales[j]));
  const inputs = rows.map((row) => normalize(row.x));
  const weights = FEATURE_NAMES.map(() => 0);
  let bias = 0;
  for (let epoch = 0; epoch < 160; epoch++) {
    const gradient = weights.map(() => 0);
    let biasGradient = 0;
    for (let i = 0; i < rows.length; i++) {
      const error =
        sigmoid(
          bias + weights.reduce((sum, w, j) => sum + w * inputs[i][j], 0),
        ) - rows[i].y;
      biasGradient += error;
      for (let j = 0; j < weights.length; j++)
        gradient[j] += error * inputs[i][j];
    }
    bias -= (0.08 * biasGradient) / rows.length;
    for (let j = 0; j < weights.length; j++)
      weights[j] -= 0.08 * (gradient[j] / rows.length + 0.02 * weights[j]);
  }
  return { weights, bias, means, scales };
}
export function predict(model, features) {
  const contributions = features.x.map(
    (v, j) => model.weights[j] * clamp((v - model.means[j]) / model.scales[j]),
  );
  const score = sigmoid(
    model.bias + contributions.reduce((sum, v) => sum + v, 0),
  );
  const direction =
    score >= 0.6 && features.trend === "Rising" && features.rsi < 75
      ? "RISE"
      : score <= 0.4 && features.trend === "Falling" && features.rsi > 25
        ? "FALL"
        : "WAIT";
  return { score, direction, contributions };
}
export function wilsonLower(wins, count) {
  if (!count) return 0;
  const z = 1.96,
    p = wins / count;
  return (
    (p +
      (z * z) / (2 * count) -
      z * Math.sqrt((p * (1 - p)) / count + (z * z) / (4 * count * count))) /
    (1 + (z * z) / count)
  );
}
export function validateModel(model, rows, baselineDirection) {
  let wins = 0,
    samples = 0,
    baselineWins = 0;
  for (const row of rows) {
    const prediction = predict(model, row);
    if (prediction.direction === "WAIT") continue;
    samples++;
    if (
      (prediction.direction === "RISE" && row.change > 0) ||
      (prediction.direction === "FALL" && row.change < 0)
    )
      wins++;
    if (
      (baselineDirection === "RISE" && row.change > 0) ||
      (baselineDirection === "FALL" && row.change < 0)
    )
      baselineWins++;
  }
  return {
    wins,
    samples,
    opportunities: rows.length,
    accuracy: samples ? wins / samples : null,
    baseline: samples ? baselineWins / samples : null,
    lowerBound: wilsonLower(wins, samples),
  };
}
export function evaluateMarket(
  input,
  { horizon = 5, now = Date.now() / 1000 } = {},
) {
  const wait = (reason) => ({
    direction: "WAIT",
    reasons: [reason],
    horizon,
    score: null,
    validation: null,
  });
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60)
    return wait("Choose a whole-minute duration from 1 to 60.");
  if (!Number.isFinite(now) || !Array.isArray(input))
    return wait("Market data is unavailable.");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (
      !c ||
      ![c.epoch, c.open, c.high, c.low, c.close].every(Number.isFinite) ||
      c.epoch % 60 !== 0 ||
      c.low <= 0 ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close) ||
      c.high < c.low ||
      (i > 0 && c.epoch <= input[i - 1].epoch) ||
      c.epoch > now
    )
      return wait("Candle data failed integrity checks.");
  }
  let candles = input.filter((c) => c.epoch + 60 <= now);
  // A weekend or missing bar ends a continuous training window.
  let start = 0;
  for (let i = 1; i < candles.length; i++)
    if (candles[i].epoch - candles[i - 1].epoch !== 60) start = i;
  candles = candles.slice(start).slice(-1000);
  if (candles.length < 400)
    return wait("Need at least 400 consecutive closed one-minute candles.");
  const last = candles.at(-1),
    asOf = last.epoch + 60,
    expires = asOf + 60;
  if (now >= expires)
    return wait(
      "Waiting for a fresh closed candle. Previous signals have expired.",
    );
  const indicators = featuresAt(candles, candles.length - 1);
  const base = {
    ...wait(""),
    asOf,
    expires,
    indicators,
    candleCount: candles.length,
  };
  if (indicators.atr <= last.close * 1e-8)
    return {
      ...base,
      reasons: [
        "The recent market is flat; there is no usable directional evidence.",
      ],
    };
  const dataset = prepareDataset(candles, horizon);
  const ups = dataset.training.filter((row) => row.y === 1).length;
  if (
    dataset.training.length < 200 ||
    ups < 20 ||
    dataset.training.length - ups < 20
  )
    return {
      ...base,
      reasons: [
        "Not enough examples of both rising and falling outcomes to train reliably.",
      ],
    };
  const model = fitModel(dataset.training);
  const prediction = predict(model, indicators);
  const validation = validateModel(
    model,
    dataset.validation,
    ups >= dataset.training.length / 2 ? "RISE" : "FALL",
  );
  const { direction, reasons } = decideSignal(prediction, validation);
  const drivers = prediction.contributions
    .map((value, i) => ({ name: FEATURE_NAMES[i], value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3);
  return {
    ...base,
    direction,
    reasons,
    drivers,
    score: prediction.score,
    validation,
    trainingCount: dataset.training.length,
    split: dataset.split,
  };
}

export function decideSignal(prediction, validation) {
  const reasons = [];
  if (validation.samples < 30)
    reasons.push(
      `Only ${validation.samples} qualifying test signals; at least 30 are required.`,
    );
  else {
    if (validation.lowerBound <= 0.5)
      reasons.push(
        "The test results do not show a reliable advantage over chance.",
      );
    if (validation.accuracy <= validation.baseline + 0.03)
      reasons.push(
        "The model has not beaten the simple direction baseline by 3 percentage points.",
      );
  }
  if (prediction.direction === "WAIT")
    reasons.push("Model strength, trend and RSI do not agree on a trade.");
  const direction = reasons.length ? "WAIT" : prediction.direction;
  if (!reasons.length)
    reasons.push(
      "Model strength and trend agree; the recent test results passed the evidence gates.",
    );
  return { direction, reasons };
}
