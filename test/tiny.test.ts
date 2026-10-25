import test from "node:test";
import assert from "node:assert/strict";

import { TinyLM, mulberry32 } from "../src/tiny/lm.ts";

function makeTiny(): TinyLM {
  // Deliberately tiny so numeric gradients are cheap: d=8, 2 heads, 1 layer.
  return new TinyLM({ vocab: 256, ctx: 6, d: 8, heads: 2, layers: 1 }, 42);
}

function randomTokens(seed: number, count: number): Int32Array {
  const rand = mulberry32(seed);
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.floor(rand() * 12);
  return out;
}

/**
 * The whole model is hand-derived backprop. If any of the kernels are wrong,
 * training silently produces garbage, so check analytic gradients against
 * numeric ones on a sample of parameters.
 */
test("analytic gradients match numeric gradients", () => {
  const model = makeTiny();
  const B = 1;
  const S = 6;
  const tokens = randomTokens(7, B * S);
  const targets = randomTokens(11, B * S);

  model.lossAndGrads(tokens, targets, B, S, true);
  const analytic = new Map<string, Float32Array>();
  for (const p of model.params) analytic.set(p.name, Float32Array.from(p.grad));

  const eps = 1e-3;
  const checks = [
    { name: "wte", indices: [3 * 8 + 1, 7 * 8 + 5] },
    { name: "wpe", indices: [2 * 8 + 3] },
    { name: "lnf.g", indices: [0, 4] },
    { name: "lnf.b", indices: [2] },
    { name: "h0.ln1.g", indices: [1] },
    { name: "h0.attn.q", indices: [0 * 8 + 2, 6 * 8 + 7] },
    { name: "h0.attn.k", indices: [3 * 8 + 3] },
    { name: "h0.attn.v", indices: [5 * 8 + 1] },
    { name: "h0.attn.o", indices: [2 * 8 + 2] },
    { name: "h0.ln2.g", indices: [5] },
    { name: "h0.mlp.1", indices: [0, 8 * 8 + 3, 30 * 8 + 5] },
    { name: "h0.mlp.b1", indices: [0, 17] },
    { name: "h0.mlp.2", indices: [4 * 8 + 6, 31 * 8 + 2] },
    { name: "h0.mlp.b2", indices: [1] },
  ];

  let checked = 0;
  for (const check of checks) {
    const param = model.params.find((p) => p.name === check.name);
    assert.ok(param, `parameter ${check.name} missing`);
    for (const index of check.indices) {
      const original = param.data[index]!;
      param.data[index] = original + eps;
      const plus = model.lossAndGrads(tokens, targets, B, S, false);
      param.data[index] = original - eps;
      const minus = model.lossAndGrads(tokens, targets, B, S, false);
      param.data[index] = original;

      const numeric = (plus - minus) / (2 * eps);
      const analyticGrad = analytic.get(check.name)![index]!;
      const scale = Math.max(1, Math.abs(numeric), Math.abs(analyticGrad));
      const diff = Math.abs(numeric - analyticGrad) / scale;
      assert.ok(
        diff < 0.02,
        `${check.name}[${index}]: analytic ${analyticGrad.toFixed(6)} vs numeric ${numeric.toFixed(6)} (rel ${diff.toFixed(4)})`,
      );
      checked++;
    }
  }
  assert.ok(checked >= 20, `only checked ${checked} gradients`);
});

test("loss is finite, lowercased by training, and deterministic", () => {
  const model = makeTiny();
  const text = new TextEncoder().encode("the quick brown fox jumps. ".repeat(20));
  const B = 2;
  const S = 6;
  const tokens = new Int32Array(B * S);
  const targets = new Int32Array(B * S);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < S; i++) {
      tokens[b * S + i] = text[b * 6 + i]!;
      targets[b * S + i] = text[b * 6 + i + 1]!;
    }
  }

  const first = model.lossAndGrads(tokens, targets, B, S, true);
  assert.ok(Number.isFinite(first));
  for (let step = 1; step <= 40; step++) {
    model.lossAndGrads(tokens, targets, B, S, true);
    model.step(0.05, 1, step);
  }
  const after = model.lossAndGrads(tokens, targets, B, S, false);
  assert.ok(after < first, `loss should drop: ${first.toFixed(3)} -> ${after.toFixed(3)}`);

  // Same weights + same input must give identical loss.
  const again = model.lossAndGrads(tokens, targets, B, S, false);
  assert.equal(after, again);
});

test("save/load round-trip preserves the model exactly", () => {
  const model = new TinyLM({ vocab: 256, ctx: 8, d: 8, heads: 2, layers: 2 }, 7);
  const tokens = randomTokens(3, 8);
  const before = model.lossAndGrads(tokens, tokens, 1, 8, false);

  const json = model.toJSON({ steps: 5, loss: before, bytes: 100 });
  assert.equal(json.format, "mox-tiny-lm");
  const restored = TinyLM.fromJSON(json);
  const after = restored.lossAndGrads(tokens, tokens, 1, 8, false);

  assert.equal(before, after);
  assert.equal(restored.parameterCount, model.parameterCount);
  assert.equal(restored.stats.steps, 5);
});

test("sampling produces bytes and respects the context window", () => {
  const model = new TinyLM({ vocab: 256, ctx: 4, d: 8, heads: 2, layers: 1 }, 5);
  const out = model.generate(new TextEncoder().encode("abc"), { maxTokens: 10, seed: 1 });
  assert.equal(out.length, 10);
  for (const byte of out) assert.ok(byte >= 0 && byte < 256);

  // A prompt longer than ctx must not throw.
  const long = new TextEncoder().encode("this prompt is definitely longer than four bytes");
  const out2 = model.generate(long, { maxTokens: 5, seed: 2 });
  assert.equal(out2.length, 5);
});

test("rejects configs where heads do not divide the model width", () => {
  assert.throws(() => new TinyLM({ vocab: 256, ctx: 8, d: 10, heads: 3, layers: 1 }), /divisible/);
});
