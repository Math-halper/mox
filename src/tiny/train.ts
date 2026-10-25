import { TinyLM, TINY_SIZES, BYTE_VOCAB, mulberry32, type TinySizeName } from "./lm.ts";

export type TrainOptions = {
  text: string;
  size?: TinySizeName;
  steps?: number;
  batchSize?: number;
  lr?: number;
  seed?: number;
  onStep?: (info: { step: number; loss: number; lr: number }) => void;
  shouldStop?: () => boolean;
};

export type TrainResult = {
  model: TinyLM;
  steps: number;
  initialLoss: number;
  finalLoss: number;
  bytes: number;
  ms: number;
  sample: string;
};

const MIN_BYTES = 400;

/** Byte-level training data straight from the folder's text. */
export function corpusToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function sampleBatch(
  data: Uint8Array,
  batchSize: number,
  blockSize: number,
  rand: () => number,
): { tokens: Int32Array; targets: Int32Array } {
  const tokens = new Int32Array(batchSize * blockSize);
  const targets = new Int32Array(batchSize * blockSize);
  const maxStart = data.length - blockSize - 1;
  for (let b = 0; b < batchSize; b++) {
    const start = Math.floor(rand() * maxStart);
    for (let i = 0; i < blockSize; i++) {
      tokens[b * blockSize + i] = data[start + i]!;
      targets[b * blockSize + i] = data[start + i + 1]!;
    }
  }
  return { tokens, targets };
}

/**
 * Train a fresh tiny model on a string. Deterministic for a given seed.
 * A "step" sees batchSize × blockSize bytes, so a minute of CPU on a small
 * folder is typically enough to reproduce its vocabulary and rhythm.
 */
export function trainTiny(opts: TrainOptions): TrainResult {
  const started = Date.now();
  const data = corpusToBytes(opts.text);
  if (data.length < MIN_BYTES) {
    throw new Error(
      `not enough text to learn from (${data.length} bytes). Add at least ${MIN_BYTES} bytes of writing to SELF.md or knowledge/, then train again.`,
    );
  }

  const sizeName = opts.size ?? "small";
  const preset = TINY_SIZES[sizeName];
  if (!preset) throw new Error(`unknown size "${sizeName}" (try nano, small, medium)`);

  const config = { vocab: BYTE_VOCAB, ...preset };
  const model = new TinyLM(config, opts.seed ?? 1337);
  const rand = mulberry32((opts.seed ?? 1337) + 99);

  const steps = Math.max(1, Math.floor(opts.steps ?? 500));
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? 4));
  const blockSize = Math.min(preset.ctx, Math.max(8, Math.floor(data.length / 4)));
  const baseLr = opts.lr ?? 0.003;
  const warmup = Math.max(1, Math.floor(steps * 0.05));

  let initialLoss = Number.NaN;
  let loss = Number.NaN;
  let step = 0;

  for (step = 1; step <= steps; step++) {
    if (opts.shouldStop?.()) {
      step--;
      break;
    }
    const { tokens, targets } = sampleBatch(data, batchSize, blockSize, rand);
    loss = model.lossAndGrads(tokens, targets, batchSize, blockSize, true);
    if (step === 1) initialLoss = loss;

    const progress = step / steps;
    const lr =
      step <= warmup
        ? (baseLr * step) / warmup
        : baseLr * (0.1 + 0.9 * 0.5 * (1 + Math.cos(Math.PI * (progress - warmup / steps) / (1 - warmup / steps))));
    model.step(lr, 1.0, step);
    opts.onStep?.({ step, loss, lr });
  }

  const sampleBytes = model.generate(new TextEncoder().encode(opts.text.slice(0, 24)), {
    maxTokens: 200,
    temperature: 0.6,
    topK: 30,
    seed: 7,
  });

  model.stats = {
    steps: step,
    loss,
    bytes: data.length,
    trainedAt: new Date().toISOString(),
  };

  return {
    model,
    steps: step,
    initialLoss,
    finalLoss: loss,
    bytes: data.length,
    ms: Date.now() - started,
    sample: decode(sampleBytes),
  };
}

/** Human-readable gauge, so nobody mistakes a 0.4M-param model for GPT. */
export function lossVerdict(loss: number): string {
  if (!Number.isFinite(loss)) return "unknown (not trained)";
  if (loss < 1.2) return "mimics the folder closely (likely memorised — that is expected at this size)";
  if (loss < 2.0) return "picks up the folder's words and rhythm";
  if (loss < 3.0) return "still learning; train longer for better babble";
  return "barely trained; the text will look random";
}
