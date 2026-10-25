# Make your own assistant: a folder is the whole thing

```bash
mox self init ./ada --name Ada     # creates the folder
mox self chat ./ada                # talk to it, with tools
mox self ask ./ada "…"             # one-shot task with that identity
mox self train ./ada               # train a small model from the folder, from scratch
mox self talk ./ada                # talk to that model
mox self info ./ada                # what is in the folder
```

There is no hidden state. Every fact, every rule about how it talks, every memory — it is all plain files in one directory that you can open, rewrite, delete, or put in git.

```
ada/
├── SELF.md              ← who it is. The most important file.
├── config.json          ← name, model backend, temperature
├── HOW-TO-EDIT.md       ← notes for you
├── knowledge/           ← *.md files: things it should know
├── skills/              ← *.md files: procedures it should follow
├── memory/
│   ├── notes.md         ← long-term notes (it can write here, so can you)
│   └── chat.jsonl       ← the conversation log
└── tiny/
    └── model.json       ← a neural network trained from this folder
```

## Two brains, one folder

This matters, so it is not buried.

**`mox self chat` uses a real model.** It runs your local model (Ollama, LM Studio, llama.cpp) with the folder's identity and knowledge in its context, plus mox's tools — shell, files, browser, HTTP. It can read your repo, run your tests, fix your code. It is as capable as the model you point it at. This is the part that can "do all of that".

**`mox self talk` uses a model trained from scratch.** It is a genuine decoder-only transformer — 70k to 370k parameters, byte-level tokenizer, hand-written backpropagation, Adam — implemented in `src/tiny/lm.ts` with no libraries at all. It trains on your folder in a couple of minutes and lives in `tiny/model.json`.

What that tiny model can do: learn the vocabulary, punctuation, and rhythm of your writing, and continue text in that voice. Run it long enough on a small corpus and it will reproduce whole phrases you wrote.

What it cannot do: answer questions, follow instructions, reason, or use tools. It has never seen the internet, has no facts beyond your folder, and at this size it produces babble most of the time. That is not a bug in the implementation — it is the difference between ~10⁵ and ~10¹² parameters, and between 9 KiB of training text and ~10¹³ tokens. Treat `talk` as a science-fair exhibit you own, not as the assistant.

## Editing it

Everything takes effect the next time you run `self chat`. No rebuild, no restart.

| Want | Do this |
|---|---|
| Change personality | Rewrite `SELF.md`. Keep the first line `# Name` if you like. |
| Teach it a fact | Drop a `.md` file in `knowledge/`. One topic per file works best. |
| Teach it a procedure | Add a file to `skills/`, e.g. "how I review a PR". |
| Make it forget a memory | Edit or delete `memory/notes.md`. |
| Wipe the conversation | `memory/chat.jsonl` — delete it, or use `/new` in chat. |
| Point it at a different model | `config.json`: `baseUrl`, `model`, `temperature`. |
| Change its name | `config.json` → `name` (and the `# Name` line in `SELF.md`). |

Edit a fact badly and the assistant gets it wrong — that is the deal, and it is also the point: you are in control of what it believes.

### Sizing the folder

The identity and knowledge files are inlined into every request, up to a budget (`SELF.md` 6,000 chars, knowledge 12,000 chars total, skills 4,000). Past that, the assistant is told the files exist and can read them with its file tools. Small local models start ignoring long preambles, so if yours gets worse after you add a lot of text, that is context pressure, not a broken folder.

## What "train from scratch" means here

`src/tiny/lm.ts` implements a GPT-style model by hand:

- byte-level tokens (vocab 256) — no tokenizer to train, any UTF-8 text works
- token + positional embeddings
- N layers of: layer norm → causal multi-head self-attention → residual → layer norm → GELU MLP → residual
- final layer norm, output head tied to the token embeddings
- softmax cross-entropy loss, Adam with warmup + cosine decay, gradient clipping

Every gradient is derived by hand and checked against finite differences in `test/tiny.test.ts`. If a kernel were wrong, that test fails.

Sizes (`--size`):

| Size | Width | Layers | Params | Rough training time (500 steps) |
|---|---|---|---|---|
| `nano` | 48 | 2 | ~70k | under a minute |
| `small` (default) | 64 | 2 | ~120k | 1–3 minutes |
| `medium` | 96 | 3 | ~370k | 5–10 minutes |

Training uses randomized windows from the folder, so more text needs more steps to absorb. A realistic loop:

```bash
mox self train ./ada --steps 500          # see the sample it prints
mox self info ./ada                       # check the loss
# add more writing to the folder, then:
mox self train ./ada --steps 1500 --size medium
```

The printed **loss** is your quality gauge: below ~1.2 it is reciting the folder, ~2 is readable-ish babble, above ~3 it is still noise. `mox self info` tells you which.

## Using it as a real assistant

`mox self chat ./ada` gives you a conversation with tools, and every tool call is still subject to mox's approval policy and sandbox. The persona is not a jailbreak: `docs/THREAT-MODEL.md` still applies, and the `SELF.md` file is *your* input, not a way for the model to grant itself permissions.

One-shot tasks work too:

```bash
mox self ask ./ada "what do you know about the battery order?"
mox self ask ./ada "rename every screenshot in ~/Pictures to its date"
```

## Keeping it

Put the folder in git. It is text:

```bash
cd ada && git init && git add -A && git commit -m "my assistant, as of today"
```

Diffing your assistant's personality over time is a strange and useful feeling.
