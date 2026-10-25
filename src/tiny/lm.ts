/**
 * A small decoder-only transformer, written from scratch.
 *
 * No ML libraries, no ONNX, no WASM — just Float32Arrays and hand-derived
 * backpropagation. It is byte-level (vocab 256), so it can learn any text
 * without a tokenizer, and its weights are a plain JSON file you can inspect.
 *
 * This is a *real* language model in the architectural sense: embeddings,
 * causal multi-head self-attention, layer norm, GELU MLP, tied output head,
 * cross-entropy loss, Adam. It is not a *good* one: at a few hundred thousand
 * parameters trained for a minute on a folder of notes, it learns the shape of
 * your words, not facts about the world. See docs/SELF.md.
 */

export type TinyConfig = {
  vocab: number;
  ctx: number;
  d: number;
  heads: number;
  layers: number;
};

export type TinySizeName = "nano" | "small" | "medium";

export const TINY_SIZES: Record<TinySizeName, Omit<TinyConfig, "vocab">> = {
  nano: { ctx: 48, d: 48, heads: 3, layers: 2 }, // ~70k parameters
  small: { ctx: 64, d: 64, heads: 4, layers: 2 },
  medium: { ctx: 96, d: 96, heads: 4, layers: 3 },
};

export const BYTE_VOCAB = 256;

// ------------------------------------------------------------------ rng

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  // Box–Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------------ params

export type Param = {
  name: string;
  size: number;
  data: Float32Array;
  grad: Float32Array;
  m: Float32Array;
  v: Float32Array;
};

function makeParam(name: string, size: number, rand: () => number, std = 0.02, fill?: number): Param {
  const data = new Float32Array(size);
  if (fill !== undefined) data.fill(fill);
  else for (let i = 0; i < size; i++) data[i] = gaussian(rand) * std;
  return {
    name,
    size,
    data,
    grad: new Float32Array(size),
    m: new Float32Array(size),
    v: new Float32Array(size),
  };
}

// ------------------------------------------------------------------ kernels

/** y[M,N] = x[M,K] · w[N,K]ᵀ  (w is stored row-per-output) */
function linearForward(
  x: Float32Array,
  w: Float32Array,
  M: number,
  K: number,
  N: number,
  y: Float32Array,
): void {
  for (let m = 0; m < M; m++) {
    const xo = m * K;
    const yo = m * N;
    for (let n = 0; n < N; n++) {
      const wo = n * K;
      let sum = 0;
      for (let k = 0; k < K; k++) sum += x[xo + k]! * w[wo + k]!;
      y[yo + n] = sum;
    }
  }
}

/** dx += dy · w, dw += dyᵀ · x */
function linearBackward(
  x: Float32Array,
  w: Float32Array,
  dy: Float32Array,
  dx: Float32Array | null,
  dw: Float32Array | null,
  M: number,
  K: number,
  N: number,
): void {
  for (let m = 0; m < M; m++) {
    const xo = m * K;
    const yo = m * N;
    for (let n = 0; n < N; n++) {
      const g = dy[yo + n]!;
      if (g === 0) continue;
      const wo = n * K;
      if (dw) for (let k = 0; k < K; k++) dw[wo + k]! += g * x[xo + k]!;
      if (dx) for (let k = 0; k < K; k++) dx[xo + k]! += g * w[wo + k]!;
    }
  }
}

/** per-row layer norm over the last dimension */
function layerNormForward(
  x: Float32Array,
  g: Float32Array,
  b: Float32Array,
  rows: number,
  D: number,
  out: Float32Array,
  mean: Float32Array,
  rstd: Float32Array,
): void {
  const eps = 1e-5;
  for (let r = 0; r < rows; r++) {
    const o = r * D;
    let mu = 0;
    for (let i = 0; i < D; i++) mu += x[o + i]!;
    mu /= D;
    let varr = 0;
    for (let i = 0; i < D; i++) {
      const diff = x[o + i]! - mu;
      varr += diff * diff;
    }
    varr /= D;
    const rs = 1 / Math.sqrt(varr + eps);
    mean[r] = mu;
    rstd[r] = rs;
    for (let i = 0; i < D; i++) {
      out[o + i] = (x[o + i]! - mu) * rs * g[i]! + b[i]!;
    }
  }
}

function layerNormBackward(
  dy: Float32Array,
  x: Float32Array,
  g: Float32Array,
  mean: Float32Array,
  rstd: Float32Array,
  dx: Float32Array,
  dg: Float32Array,
  db: Float32Array,
  rows: number,
  D: number,
): void {
  for (let r = 0; r < rows; r++) {
    const o = r * D;
    const mu = mean[r]!;
    const rs = rstd[r]!;
    // dout_i = dy_i * g_i, then the standard layernorm input gradient.
    let sumDout = 0;
    let sumDoutXhat = 0;
    for (let i = 0; i < D; i++) {
      const xhat = (x[o + i]! - mu) * rs;
      const dyi = dy[o + i]!;
      dg[i]! += dyi * xhat;
      db[i]! += dyi;
      const dout = dyi * g[i]!;
      sumDout += dout;
      sumDoutXhat += dout * xhat;
    }
    for (let i = 0; i < D; i++) {
      const xhat = (x[o + i]! - mu) * rs;
      const dout = dy[o + i]! * g[i]!;
      dx[o + i]! += (rs / D) * (D * dout - sumDout - xhat * sumDoutXhat);
    }
  }
}

const GELU_C = Math.sqrt(2 / Math.PI);
const GELU_C3 = 0.044715;

function gelu(x: number): number {
  const inner = GELU_C * (x + GELU_C3 * x * x * x);
  return 0.5 * x * (1 + Math.tanh(inner));
}

function geluBackward(x: number, dy: number): number {
  const inner = GELU_C * (x + GELU_C3 * x * x * x);
  const t = Math.tanh(inner);
  const dInner = GELU_C * (1 + 3 * GELU_C3 * x * x);
  return dy * (0.5 * (1 + t) + 0.5 * x * (1 - t * t) * dInner);
}

function addInPlace(target: Float32Array, source: Float32Array): void {
  for (let i = 0; i < target.length; i++) target[i]! += source[i]!;
}

// ------------------------------------------------------------------ model

type LayerWeights = {
  ln1g: Param;
  ln1b: Param;
  wq: Param;
  wk: Param;
  wv: Param;
  wo: Param;
  ln2g: Param;
  ln2b: Param;
  w1: Param;
  b1: Param;
  w2: Param;
  b2: Param;
};

export type ModelJson = {
  format: "mox-tiny-lm";
  version: 1;
  config: TinyConfig;
  steps: number;
  loss: number;
  bytes: number;
  trainedAt: string;
  params: string; // base64 of every Float32Array, concatenated in manifest order
};

export class TinyLM {
  readonly config: TinyConfig;
  params: Param[] = [];
  private readonly wte: Param;
  private readonly wpe: Param;
  private readonly lnfg: Param;
  private readonly lnfb: Param;
  private readonly layers: LayerWeights[] = [];
  private readonly rand: () => number;

  // Scratch buffers, allocated once per shape to keep the hot loop allocation-free.
  private cache: Record<string, Float32Array> = {};
  private readonly headDim: number;

  stats = { steps: 0, loss: Number.NaN, bytes: 0, trainedAt: "" };

  constructor(config: TinyConfig, seed = 1337) {
    if (config.d % config.heads !== 0) {
      throw new Error(`d (${config.d}) must be divisible by heads (${config.heads})`);
    }
    this.config = { ...config, vocab: BYTE_VOCAB };
    this.headDim = config.d / config.heads;
    this.rand = mulberry32(seed);

    this.wte = makeParam("wte", BYTE_VOCAB * config.d, this.rand, 0.02);
    this.wpe = makeParam("wpe", config.ctx * config.d, this.rand, 0.02);
    this.params.push(this.wte, this.wpe);
    for (let l = 0; l < config.layers; l++) {
      const p = `h${l}.`;
      const layer: LayerWeights = {
        ln1g: makeParam(`${p}ln1.g`, config.d, this.rand, 0, 1),
        ln1b: makeParam(`${p}ln1.b`, config.d, this.rand, 0, 0),
        wq: makeParam(`${p}attn.q`, config.d * config.d, this.rand),
        wk: makeParam(`${p}attn.k`, config.d * config.d, this.rand),
        wv: makeParam(`${p}attn.v`, config.d * config.d, this.rand),
        wo: makeParam(`${p}attn.o`, config.d * config.d, this.rand),
        ln2g: makeParam(`${p}ln2.g`, config.d, this.rand, 0, 1),
        ln2b: makeParam(`${p}ln2.b`, config.d, this.rand, 0, 0),
        w1: makeParam(`${p}mlp.1`, config.d * 4 * config.d, this.rand),
        b1: makeParam(`${p}mlp.b1`, config.d * 4, this.rand, 0, 0),
        w2: makeParam(`${p}mlp.2`, config.d * 4 * config.d, this.rand),
        b2: makeParam(`${p}mlp.b2`, config.d, this.rand, 0, 0),
      };
      this.layers.push(layer);
      this.params.push(...Object.values(layer));
    }
    this.lnfg = makeParam("lnf.g", config.d, this.rand, 0, 1);
    this.lnfb = makeParam("lnf.b", config.d, this.rand, 0, 0);
    this.params.push(this.lnfg, this.lnfb);
  }

  get parameterCount(): number {
    let n = 0;
    for (const p of this.params) n += p.size;
    return n;
  }

  private buf(key: string, size: number): Float32Array {
    const existing = this.cache[key];
    if (existing && existing.length === size) {
      existing.fill(0);
      return existing;
    }
    const fresh = new Float32Array(size);
    this.cache[key] = fresh;
    return fresh;
  }

  private zeroGrads(): void {
    for (const p of this.params) p.grad.fill(0);
  }

  /**
   * Forward pass. tokens/targets are [B*S] byte ids.
   * Returns the mean cross-entropy and fills parameter gradients.
   */
  lossAndGrads(
    tokens: Int32Array,
    targets: Int32Array,
    B: number,
    S: number,
    computeGrads = true,
  ): number {
    const { d, ctx, heads, layers } = this.config;
    if (S > ctx) throw new Error(`sequence length ${S} exceeds ctx ${ctx}`);
    const D = d;
    const H = heads;
    const hd = this.headDim;
    const rows = B * S;
    const scale = 1 / Math.sqrt(hd);

    if (computeGrads) this.zeroGrads();

    // embeddings
    const x = this.buf("x", rows * D);
    for (let r = 0; r < rows; r++) {
      const tok = tokens[r]!;
      const pos = r % S;
      const eo = tok * D;
      const po = pos * D;
      const xo = r * D;
      for (let i = 0; i < D; i++) x[xo + i] = this.wte.data[eo + i]! + this.wpe.data[po + i]!;
    }

    type Saved = {
      xIn: Float32Array;
      h1: Float32Array;
      mean1: Float32Array;
      rstd1: Float32Array;
      q: Float32Array;
      k: Float32Array;
      v: Float32Array;
      probs: Float32Array;
      attn: Float32Array;
      xMid: Float32Array;
      h2: Float32Array;
      mean2: Float32Array;
      rstd2: Float32Array;
      mpre: Float32Array;
      mact: Float32Array;
    };
    const saved: Saved[] = [];

    const lnRows = rows;
    for (let l = 0; l < layers; l++) {
      const w = this.layers[l]!;
      const xIn = this.buf(`l${l}.xIn`, rows * D);
      xIn.set(x);

      const h1 = this.buf(`l${l}.h1`, rows * D);
      const mean1 = this.buf(`l${l}.mean1`, lnRows);
      const rstd1 = this.buf(`l${l}.rstd1`, lnRows);
      layerNormForward(x, w.ln1g.data, w.ln1b.data, lnRows, D, h1, mean1, rstd1);

      const q = this.buf(`l${l}.q`, rows * D);
      const k = this.buf(`l${l}.k`, rows * D);
      const v = this.buf(`l${l}.v`, rows * D);
      linearForward(h1, w.wq.data, rows, D, D, q);
      linearForward(h1, w.wk.data, rows, D, D, k);
      linearForward(h1, w.wv.data, rows, D, D, v);

      const probs = this.buf(`l${l}.probs`, B * H * S * S);
      const attn = this.buf(`l${l}.attn`, rows * D);

      for (let b = 0; b < B; b++) {
        for (let h = 0; h < H; h++) {
          const off = h * hd;
          for (let i = 0; i < S; i++) {
            const rowIdx = (b * S + i);
            const pBase = ((b * H + h) * S + i) * S;
            let maxScore = -Infinity;
            for (let j = 0; j <= i; j++) {
              const jRow = b * S + j;
              let dot = 0;
              for (let c = 0; c < hd; c++) dot += q[rowIdx * D + off + c]! * k[jRow * D + off + c]!;
              const score = dot * scale;
              probs[pBase + j] = score;
              if (score > maxScore) maxScore = score;
            }
            let denom = 0;
            for (let j = 0; j <= i; j++) {
              const e = Math.exp(probs[pBase + j]! - maxScore);
              probs[pBase + j] = e;
              denom += e;
            }
            for (let j = 0; j <= i; j++) probs[pBase + j]! /= denom;
            for (let c = 0; c < hd; c++) {
              let acc = 0;
              for (let j = 0; j <= i; j++) {
                acc += probs[pBase + j]! * v[(b * S + j) * D + off + c]!;
              }
              attn[rowIdx * D + off + c] = acc;
            }
          }
        }
      }

      const proj = this.buf(`l${l}.proj`, rows * D);
      linearForward(attn, w.wo.data, rows, D, D, proj);
      const xMid = this.buf(`l${l}.xMid`, rows * D);
      for (let i = 0; i < rows * D; i++) xMid[i] = x[i]! + proj[i]!;

      const h2 = this.buf(`l${l}.h2`, rows * D);
      const mean2 = this.buf(`l${l}.mean2`, lnRows);
      const rstd2 = this.buf(`l${l}.rstd2`, lnRows);
      layerNormForward(xMid, w.ln2g.data, w.ln2b.data, lnRows, D, h2, mean2, rstd2);

      const mpre = this.buf(`l${l}.mpre`, rows * 4 * D);
      linearForward(h2, w.w1.data, rows, D, 4 * D, mpre);
      const mact = this.buf(`l${l}.mact`, rows * 4 * D);
      for (let i = 0; i < rows * 4 * D; i++) mact[i] = gelu(mpre[i]! + w.b1.data[i % (4 * D)]!);

      const mlpOut = this.buf(`l${l}.mlpOut`, rows * D);
      linearForward(mact, w.w2.data, rows, 4 * D, D, mlpOut);
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < D; i++) x[r * D + i] = xMid[r * D + i]! + mlpOut[r * D + i]! + w.b2.data[i]!;
      }

      saved.push({ xIn, h1, mean1, rstd1, q, k, v, probs, attn, xMid, h2, mean2, rstd2, mpre, mact });
    }

    const xf = this.buf("xf", rows * D);
    const meanF = this.buf("meanF", rows);
    const rstdF = this.buf("rstdF", rows);
    layerNormForward(x, this.lnfg.data, this.lnfb.data, rows, D, xf, meanF, rstdF);

    // logits, tied to the embedding matrix
    const logits = this.buf("logits", rows * BYTE_VOCAB);
    const dlogits = this.buf("dlogits", rows * BYTE_VOCAB);
    linearForward(xf, this.wte.data, rows, D, BYTE_VOCAB, logits);

    let loss = 0;
    for (let r = 0; r < rows; r++) {
      const o = r * BYTE_VOCAB;
      let max = -Infinity;
      for (let v = 0; v < BYTE_VOCAB; v++) if (logits[o + v]! > max) max = logits[o + v]!;
      let sum = 0;
      for (let v = 0; v < BYTE_VOCAB; v++) sum += Math.exp(logits[o + v]! - max);
      const t = targets[r]!;
      loss += -(logits[o + t]! - max - Math.log(sum));
      // softmax - onehot, scaled by 1/rows for the mean loss
      for (let v = 0; v < BYTE_VOCAB; v++) {
        const p = Math.exp(logits[o + v]! - max) / sum;
        dlogits[o + v] = (p - (v === t ? 1 : 0)) / rows;
      }
    }
    loss /= rows;

    if (!computeGrads) return loss;

    // backward through the tied head
    const dxf = this.buf("dxf", rows * D);
    linearBackward(xf, this.wte.data, dlogits, dxf, this.wte.grad, rows, D, BYTE_VOCAB);

    const dx = this.buf("dx", rows * D);
    layerNormBackward(
      dxf,
      x,
      this.lnfg.data,
      meanF,
      rstdF,
      dx,
      this.lnfg.grad,
      this.lnfb.grad,
      rows,
      D,
    );

    for (let l = layers - 1; l >= 0; l--) {
      const w = this.layers[l]!;
      const s = saved[l]!;

      // mlp: x = xMid + mlpOut + b2
      const dmlpOut = this.buf(`l${l}.dmlpOut`, rows * D);
      dmlpOut.set(dx);
      for (let i = 0; i < rows * D; i++) w.b2.grad[i % D]! += dx[i]!;

      const dmact = this.buf(`l${l}.dmact`, rows * 4 * D);
      linearBackward(s.mact, w.w2.data, dmlpOut, dmact, w.w2.grad, rows, 4 * D, D);

      const dmpre = this.buf(`l${l}.dmpre`, rows * 4 * D);
      for (let i = 0; i < rows * 4 * D; i++) {
        const pre = s.mpre[i]! + w.b1.data[i % (4 * D)]!;
        dmpre[i] = geluBackward(pre, dmact[i]!);
        w.b1.grad[i % (4 * D)]! += dmpre[i]!;
      }

      const dh2 = this.buf(`l${l}.dh2`, rows * D);
      linearBackward(s.h2, w.w1.data, dmpre, dh2, w.w1.grad, rows, D, 4 * D);

      const dxMid = this.buf(`l${l}.dxMid`, rows * D);
      dxMid.set(dx);
      layerNormBackward(
        dh2,
        s.xMid,
        w.ln2g.data,
        s.mean2,
        s.rstd2,
        dxMid,
        w.ln2g.grad,
        w.ln2b.grad,
        rows,
        D,
      );

      // attention: dxMid = dx + proj
      const dproj = this.buf(`l${l}.dproj`, rows * D);
      dproj.set(dxMid);
      const dattn = this.buf(`l${l}.dattn`, rows * D);
      linearBackward(s.attn, w.wo.data, dproj, dattn, w.wo.grad, rows, D, D);

      const dq = this.buf(`l${l}.dq`, rows * D);
      const dk = this.buf(`l${l}.dk`, rows * D);
      const dv = this.buf(`l${l}.dv`, rows * D);
      const dprobs = this.buf(`l${l}.dprobs`, B * H * S * S);

      for (let b = 0; b < B; b++) {
        for (let h = 0; h < H; h++) {
          const off = h * hd;
          for (let i = 0; i < S; i++) {
            const rowIdx = b * S + i;
            const pBase = ((b * H + h) * S + i) * S;
            // dP_st = dAttn_s · V_t ; dV_t += P_st dAttn_s
            for (let j = 0; j <= i; j++) {
              let dp = 0;
              for (let c = 0; c < hd; c++) {
                dp += dattn[rowIdx * D + off + c]! * s.v[(b * S + j) * D + off + c]!;
              }
              dprobs[pBase + j] = dp;
              const p = s.probs[pBase + j]!;
              for (let c = 0; c < hd; c++) {
                dv[(b * S + j) * D + off + c]! += p * dattn[rowIdx * D + off + c]!;
              }
            }
            // softmax backward
            let dot = 0;
            for (let j = 0; j <= i; j++) dot += s.probs[pBase + j]! * dprobs[pBase + j]!;
            for (let j = 0; j <= i; j++) {
              const dscore = s.probs[pBase + j]! * (dprobs[pBase + j]! - dot) * scale;
              for (let c = 0; c < hd; c++) {
                dq[rowIdx * D + off + c]! += dscore * s.k[(b * S + j) * D + off + c]!;
                dk[(b * S + j) * D + off + c]! += dscore * s.q[rowIdx * D + off + c]!;
              }
            }
          }
        }
      }

      const dh1 = this.buf(`l${l}.dh1`, rows * D);
      linearBackward(s.h1, w.wq.data, dq, dh1, w.wq.grad, rows, D, D);
      linearBackward(s.h1, w.wk.data, dk, dh1, w.wk.grad, rows, D, D);
      linearBackward(s.h1, w.wv.data, dv, dh1, w.wv.grad, rows, D, D);

      // residual into the layer input: dx already holds the gradient of xMid
      dx.set(dxMid);
      layerNormBackward(
        dh1,
        s.xIn,
        w.ln1g.data,
        s.mean1,
        s.rstd1,
        dx,
        w.ln1g.grad,
        w.ln1b.grad,
        rows,
        D,
      );
    }

    // embedding gradients
    for (let r = 0; r < rows; r++) {
      const tok = tokens[r]!;
      const pos = r % S;
      const eo = tok * D;
      const po = pos * D;
      const xo = r * D;
      for (let i = 0; i < D; i++) {
        this.wte.grad[eo + i]! += dx[xo + i]!;
        this.wpe.grad[po + i]! += dx[xo + i]!;
      }
    }

    return loss;
  }

  /** Greedy/temperature sampling for chat. Returns generated byte ids. */
  generate(
    prompt: Uint8Array,
    opts: { maxTokens?: number; temperature?: number; topK?: number; seed?: number } = {},
  ): Uint8Array {
    const maxTokens = opts.maxTokens ?? 80;
    const temperature = opts.temperature ?? 0.8;
    const topK = Math.min(opts.topK ?? 40, BYTE_VOCAB);
    const rand = mulberry32(opts.seed ?? Date.now());
    const { ctx } = this.config;
    const history: number[] = Array.from(prompt);
    const out: number[] = [];

    for (let step = 0; step < maxTokens; step++) {
      const window = history.slice(-ctx);
      const S = window.length;
      const tokens = Int32Array.from(window);
      const logits = this.logitsFor(tokens, S);
      // penalise repeating the same byte immediately, which small models love
      const last = history[history.length - 1];
      if (last !== undefined) logits[last] = logits[last]! - 1.2;

      const scaled = new Float32Array(BYTE_VOCAB);
      let max = -Infinity;
      for (let i = 0; i < BYTE_VOCAB; i++) {
        scaled[i] = logits[i]! / Math.max(0.01, temperature);
        if (scaled[i]! > max) max = scaled[i]!;
      }
      const order = Array.from({ length: BYTE_VOCAB }, (_v, i) => i).sort(
        (a, b) => scaled[b]! - scaled[a]!,
      );
      const keep = order.slice(0, Math.max(1, topK));
      let sum = 0;
      const weights = new Float32Array(BYTE_VOCAB);
      for (const index of keep) {
        const w = Math.exp(scaled[index]! - max);
        weights[index] = w;
        sum += w;
      }
      let pick = rand() * sum;
      let chosen = keep[0]!;
      for (const index of keep) {
        pick -= weights[index]!;
        if (pick <= 0) {
          chosen = index;
          break;
        }
      }
      history.push(chosen);
      out.push(chosen);
      if (history.length > ctx * 2) history.splice(0, history.length - ctx);
    }
    return Uint8Array.from(out);
  }

  /** Logits for the final position of a token sequence. */
  logitsFor(tokens: Int32Array, S: number): Float32Array {
    const { d } = this.config;
    const D = d;
    // Reuse the batched forward with B=1 and no gradients.
    const B = 1;
    const rows = S;
    this.lossAndGrads(tokens, tokens, B, S, false);
    const xf = this.cache["xf"]!;
    const out = new Float32Array(BYTE_VOCAB);
    const off = (rows - 1) * D;
    for (let v = 0; v < BYTE_VOCAB; v++) {
      const wo = v * D;
      let sum = 0;
      for (let i = 0; i < D; i++) sum += xf[off + i]! * this.wte.data[wo + i]!;
      out[v] = sum;
    }
    return out;
  }

  // ---------------------------------------------------------------- optimization

  step(lr: number, clip = 1.0, timestep = 1): void {
    let norm = 0;
    for (const p of this.params) {
      for (let i = 0; i < p.size; i++) norm += p.grad[i]! * p.grad[i]!;
    }
    norm = Math.sqrt(norm);
    const scale = norm > clip ? clip / norm : 1;

    const beta1 = 0.9;
    const beta2 = 0.99;
    const eps = 1e-8;
    const bc1 = 1 - Math.pow(beta1, timestep);
    const bc2 = 1 - Math.pow(beta2, timestep);
    for (const p of this.params) {
      for (let i = 0; i < p.size; i++) {
        const g = p.grad[i]! * scale;
        p.m[i] = beta1 * p.m[i]! + (1 - beta1) * g;
        p.v[i] = beta2 * p.v[i]! + (1 - beta2) * g * g;
        const mh = p.m[i]! / bc1;
        const vh = p.v[i]! / bc2;
        p.data[i]! -= (lr * mh) / (Math.sqrt(vh) + eps);
      }
    }
  }

  // ---------------------------------------------------------------- persistence

  toJSON(extra: { steps: number; loss: number; bytes: number }): ModelJson {
    let total = 0;
    for (const p of this.params) total += p.size;
    const all = new Float32Array(total);
    let offset = 0;
    for (const p of this.params) {
      all.set(p.data, offset);
      offset += p.size;
    }
    return {
      format: "mox-tiny-lm",
      version: 1,
      config: this.config,
      steps: extra.steps,
      loss: extra.loss,
      bytes: extra.bytes,
      trainedAt: new Date().toISOString(),
      params: Buffer.from(all.buffer, all.byteOffset, all.byteLength).toString("base64"),
    };
  }

  static fromJSON(json: ModelJson): TinyLM {
    if (json.format !== "mox-tiny-lm") throw new Error("not a mox tiny model file");
    const model = new TinyLM(json.config);
    const raw = Buffer.from(json.params, "base64");
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    let offset = 0;
    for (const p of model.params) {
      if (offset + p.size > all.length) {
        throw new Error(`model file is truncated (${json.params.length} bases)`);
      }
      p.data.set(all.subarray(offset, offset + p.size));
      offset += p.size;
    }
    model.stats = {
      steps: json.steps,
      loss: json.loss,
      bytes: json.bytes,
      trainedAt: json.trainedAt,
    };
    return model;
  }
}

export { addInPlace, gelu, geluBackward };
