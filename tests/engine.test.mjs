import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMarket,
  prepareDataset,
  fitModel,
  predict,
  validateModel,
  wilsonLower,
  featuresAt,
  decideSignal,
} from "../web/engine.js";

function candles(count = 1000) {
  let seed = 82917,
    price = 100;
  return Array.from({ length: count }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const open = price;
    price *= Math.exp(
      (seed / 2 ** 32 - 0.5) * 0.006 + Math.sin(i / 30) * 0.0003,
    );
    return {
      epoch: 1800000000 + i * 60,
      open,
      close: price,
      high: Math.max(open, price) + 0.01,
      low: Math.min(open, price) - 0.01,
    };
  });
}
const settings = (data) => ({ now: data.at(-1).epoch + 61, horizon: 5 });
test("deterministic market evaluation fits a finite model and reports validation evidence", () => {
  const data = candles(),
    result = evaluateMarket(data, settings(data));
  assert.deepEqual(result, evaluateMarket(data, settings(data)));
  assert.ok(result.trainingCount >= 200);
  assert.ok(
    Number.isFinite(result.score) && result.score >= 0 && result.score <= 1,
  );
  assert.ok(result.validation.opportunities > 0);
  assert.equal(result.expires, data.at(-1).epoch + 120);
  if (result.validation.samples < 30) assert.equal(result.direction, "WAIT");
});
test("training labels end before held-out data; validation outcomes never overlap", () => {
  const data = candles();
  for (const horizon of [1, 5, 60]) {
    const dataset = prepareDataset(data, horizon);
    assert.ok(dataset.training.every((row) => row.targetIndex < dataset.split));
    assert.ok(dataset.validation.every((row) => row.index >= dataset.split));
    for (let i = 1; i < dataset.validation.length; i++)
      assert.ok(
        dataset.validation[i].index >= dataset.validation[i - 1].targetIndex,
      );
  }
});
test("changing held-out prices cannot change training features, labels or fitted parameters", () => {
  const data = candles(),
    first = prepareDataset(data, 5);
  const changed = data.map((c, i) =>
    i < first.split
      ? c
      : {
          ...c,
          open: c.open * 1.2,
          high: c.high * 1.2,
          low: c.low * 1.2,
          close: c.close * 1.2,
        },
  );
  const second = prepareDataset(changed, 5);
  assert.deepEqual(first.training, second.training);
  assert.deepEqual(fitModel(first.training), fitModel(second.training));
});
test("features only see candles at or before the prediction time", () => {
  const data = candles();
  assert.deepEqual(featuresAt(data, 400), featuresAt(data.slice(0, 401), 400));
});
test("incomplete candle does not change model or signal; stale history expires", () => {
  const data = candles(),
    options = settings(data);
  const next = {
    ...data.at(-1),
    epoch: data.at(-1).epoch + 60,
    high: 9999,
    close: 999,
  };
  assert.deepEqual(
    evaluateMarket([...data, next], options),
    evaluateMarket(data, options),
  );
  const stale = evaluateMarket(data, {
    ...options,
    now: data.at(-1).epoch + 120,
  });
  assert.equal(stale.direction, "WAIT");
  assert.equal(stale.score, null);
  assert.match(stale.reasons[0], /fresh closed candle/);
});
test("malformed, unsorted, duplicate or future candles never produce a signal", () => {
  const data = candles(),
    options = settings(data);
  for (const patch of [
    { close: NaN },
    { high: 0 },
    { low: -1 },
    { epoch: data[499].epoch },
    { epoch: data[500].epoch + 1 },
    { epoch: options.now + 600 },
  ]) {
    const broken = data.map((c, i) => (i === 500 ? { ...c, ...patch } : c));
    const result = evaluateMarket(broken, options);
    assert.equal(result.direction, "WAIT");
    assert.equal(result.score, null);
    assert.match(result.reasons[0], /integrity/);
  }
});
test("a recent gap, insufficient history, flat prices and invalid horizons abstain", () => {
  const data = candles(),
    options = settings(data);
  const gapped = data.filter((_, i) => i !== 800);
  assert.match(evaluateMarket(gapped, options).reasons[0], /400 consecutive/);
  assert.equal(evaluateMarket(data.slice(-100), options).direction, "WAIT");
  const flat = data.map((c) => ({
    ...c,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
  }));
  const flatResult = evaluateMarket(flat, options);
  assert.equal(flatResult.direction, "WAIT");
  assert.match(flatResult.reasons[0], /flat/);
  for (const horizon of [0, -1, 1.5, NaN, 61])
    assert.equal(evaluateMarket(data, { ...options, horizon }).score, null);
});
test("learns both directions from labeled examples instead of a fixed score", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    x: [i % 2 ? 1 : -1, 0, 0, 0, 0, 0],
    y: i % 2,
  }));
  const model = fitModel(rows);
  assert.equal(
    predict(model, { x: [1, 0, 0, 0, 0, 0], trend: "Rising", rsi: 60 })
      .direction,
    "RISE",
  );
  assert.equal(
    predict(model, { x: [-1, 0, 0, 0, 0, 0], trend: "Falling", rsi: 40 })
      .direction,
    "FALL",
  );
  assert.equal(
    predict(model, { x: [1, 0, 0, 0, 0, 0], trend: "Mixed", rsi: 60 })
      .direction,
    "WAIT",
  );
  assert.equal(
    predict(model, { x: [1, 0, 0, 0, 0, 0], trend: "Rising", rsi: 80 })
      .direction,
    "WAIT",
  );
});
test("validation uses the same signal filters, counts ties as misses, and checks a fixed baseline", () => {
  const model = {
    weights: [2, 0, 0, 0, 0, 0],
    bias: 0,
    means: [0, 0, 0, 0, 0, 0],
    scales: [1, 1, 1, 1, 1, 1],
  };
  const rows = [
    { x: [1, 0, 0, 0, 0, 0], trend: "Rising", rsi: 60, change: 1 },
    { x: [-1, 0, 0, 0, 0, 0], trend: "Falling", rsi: 40, change: -1 },
    { x: [1, 0, 0, 0, 0, 0], trend: "Rising", rsi: 60, change: 0 },
    { x: [1, 0, 0, 0, 0, 0], trend: "Mixed", rsi: 60, change: 1 },
  ];
  const result = validateModel(model, rows, "RISE");
  assert.equal(result.samples, 3);
  assert.equal(result.wins, 2);
  assert.equal(result.baseline, 1 / 3);
  assert.ok(wilsonLower(15, 30) < 0.5);
  assert.ok(wilsonLower(26, 30) > 0.5);
  assert.equal(wilsonLower(0, 0), 0);
});

test("actionable signals require every evidence gate and never arise from score alone", () => {
  const valid = {
    samples: 60,
    lowerBound: 0.58,
    accuracy: 0.72,
    baseline: 0.52,
  };
  assert.equal(decideSignal({ direction: "RISE" }, valid).direction, "RISE");
  assert.equal(decideSignal({ direction: "FALL" }, valid).direction, "FALL");
  assert.equal(decideSignal({ direction: "WAIT" }, valid).direction, "WAIT");
  for (const patch of [
    { samples: 29 },
    { lowerBound: 0.5 },
    { accuracy: 0.55 },
    { baseline: 0.72 },
  ]) {
    assert.equal(
      decideSignal({ direction: "RISE" }, { ...valid, ...patch }).direction,
      "WAIT",
    );
  }
});
