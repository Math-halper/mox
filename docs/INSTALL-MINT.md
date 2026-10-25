# mox on Linux Mint, step by step

From a fresh Mint install to a chat window in your application menu. Roughly
15 minutes, most of it waiting for a model download.

Tested commands assume Mint 21.x or 22.x, Cinnamon or Xfce or MATE — the menu
entry is a standard `.desktop` file, so it works on all three.

> **Which code do I install?** `mox app` and `mox self` live on the branch
> `arena/896496a9-mox` (pull request #3). Until that is merged, use the `-b`
> clone below. After it is merged, the one-line `curl … | bash` installer works
> and steps 2–3 become a single command.

---

## Step 0 — what you need

- Linux Mint with a working desktop session.
- **8 GB RAM minimum.** 16 GB is comfortable. A model at 4-bit needs roughly its
  size in RAM: `qwen3:4b` ≈ 3 GB, `qwen3:8b` ≈ 6 GB, `qwen3:14b` ≈ 10 GB.
- **10 GB free disk** for the model plus Node, if you need it.
- An internet connection for the install and the model download. After that,
  mox runs offline.

Check your version and free space:

```bash
lsb_release -d          # e.g. "Linux Mint 22.1"
free -h                 # look at "total" and "available"
df -h ~ | tail -1       # look at "Avail"
```

Open a terminal: **Ctrl+Alt+T**.

---

## Step 1 — get the code and run the installer

```bash
cd ~
git clone -b arena/896496a9-mox https://github.com/Math-halper/mox
cd mox
./install.sh
```

If `git` is missing, `sudo apt install -y git` first. The installer asks a few
questions; here is what each one means:

| Prompt | Answer | Why |
|---|---|---|
| "Install bubblewrap with apt?" | **y** | Gives you the filesystem sandbox. Costs a password, ~200 KB. |
| "your kernel blocks unprivileged user namespaces … Apply the sysctl fix now?" | **y** on Mint 22 / 21.3+ | Without it `bwrap` fails with `setting up uid map: Permission denied`. It writes one file, `/etc/sysctl.d/60-mox-userns.conf`, and can be removed later. |
| "Install Ollama now …?" | **y** | This is the "brain". Without a model server the app opens but cannot answer. |
| "Download qwen3:8b now? (~5 GB)" | **y** if you have 16 GB RAM; else skip and pull `qwen3:4b` in step 3 | See step 3. |

The installer never uses `sudo` for mox itself. Everything it installs for you
lives under `~/.local`:

```
~/.local/bin/mox                        launcher on your PATH
~/.local/share/mox/app                  the application
~/.local/share/mox/node                 a private Node 22, only if yours was too old
~/.local/share/applications/mox.desktop the menu entry
~/mox-assistant/                        your assistant's folder
```

When it finishes, it prints `mox doctor` output. Read the last lines — it tells
you exactly what is working.

---

## Step 2 — open a new terminal

The installer added `~/.local/bin` to your `PATH` in `~/.profile`. Existing
terminals will not see it.

Open a new terminal (Ctrl+Alt+T) or run:

```bash
source ~/.profile
mox --version          # should print 0.2.0
```

If it says `mox: command not found`, `~/.local/bin` is not on your PATH. Add it:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile && source ~/.profile
```

---

## Step 3 — make sure a model is running

The app is a shell; the model is the mind. Check:

```bash
mox doctor
```

You want to see a line like:

```
✓ model server: http://127.0.0.1:11434/v1 (1 model)
✓ model: qwen3:8b
```

If instead you see `✗ model server: cannot reach …`, start it:

```bash
# if the Ollama installer set up the service (usual):
sudo systemctl enable --now ollama

# or run it in this terminal:
ollama serve
```

Then download a model if you did not in step 1:

```bash
ollama pull qwen3:8b      # ~5 GB, 16 GB RAM machines
# ollama pull qwen3:4b    # ~2.5 GB, 8 GB RAM machines
# ollama pull qwen3:14b   # ~9 GB, 32 GB machines or a GPU
```

Run `mox doctor` again. You are ready when the model server line is green.

---

## Step 4 — launch the app

**From the menu:** press the Mint menu key (or click Menu), type `mox`, click the
entry. A window opens with the title of your assistant.

**From a terminal:**

```bash
mox app
```

Both do the same thing: start a local server on `127.0.0.1` with a random token,
then open a chromeless Chromium window. Close the window or press Ctrl+C in the
terminal to stop it.

If Chromium is not installed, it opens in your default browser (Firefox) as a
tab — it works identically, just less app-like. To get the real window:

```bash
sudo apt install -y chromium
```

---

## Step 5 — talk to it

Type in the box at the bottom and press Enter.

Start with something that shows the machinery:

```
what do you know about me?
```

It will call its file tools to read `~/mox-assistant/`, and then **stop and ask
for approval** before anything runs. That is the design: read-only actions run
freely, anything that changes state (shell commands, writes) waits for you.
Click **Allow once** and it continues.

Try a real task:

```
list the files in my home directory and tell me what the biggest one is
```

Watch the tool cards appear as it works. The **Stop** button interrupts a run.

---

## Step 6 — make it yours

Everything about the assistant is a file you can edit. Open the folder:

```bash
xdg-open ~/mox-assistant
```

| File | What it does |
|---|---|
| `SELF.md` | Its name, voice, rules. The most important file. |
| `knowledge/*.md` | Facts it should know. One topic per file. |
| `skills/*.md` | Procedures, e.g. "how I like code reviewed". |
| `memory/notes.md` | Things it remembered; you can edit or delete them. |
| `config.json` | Name, model, backend URL, temperature. |

Edits take effect on your **next message in the open window** — no restart.

Example: put this in `SELF.md`

```markdown
# Nova

You are Nova, my local assistant. You are blunt, you never flatter me, and you
always tell me the command you ran.
```

Send one more message and it is Nova.

---

## Step 7 — use it on your actual work

The window's assistant works in the folder it was launched from. To use it on a
project, launch it there:

```bash
cd ~/projects/my-app
mox app
```

Or point the menu entry at a folder of its own — see "Customising the menu entry"
below.

Terminal alternatives, for when a window is in the way:

```bash
mox "explain what this repo does"     # one task, prints the answer
mox chat                              # interactive in the terminal
mox runs                              # every past run
mox show latest                       # replay the last run call by call
```

---

## Customising the menu entry

The installer created `~/.local/share/applications/mox.desktop` pointing at
`~/mox-assistant`. To change the folder or the name shown in the menu:

```bash
nano ~/.local/share/applications/mox.desktop
```

Relevant lines:

```ini
Name=mox
Exec=/home/you/.local/bin/mox app "/home/you/mox-assistant"
```

Change the quoted folder, or add flags such as `--port 9000` or `--demo`. Save,
then the menu picks it up (log out and back in if it does not).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `mox: command not found` | PATH not loaded | `source ~/.profile` or open a new terminal |
| Window shows "cannot reach model server" | Ollama not running | `sudo systemctl start ollama`, then send the message again |
| `bwrap` fails: `setting up uid map: Permission denied` | Mint 22 AppArmor restriction | `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`, or re-run `./install.sh` and accept the fix. `mox doctor` shows whether the sandbox is active |
| Menu entry missing | Desktop cache | `mox app --install-shortcut`, or log out and back in |
| `mox app` opens a Firefox tab | No Chromium | `sudo apt install -y chromium` for the chromeless window |
| App window blank | Server failed to start | Run `mox app` in a terminal and read the error; log is at `~/.local/share/mox/app.log` |
| Answers are slow (5–20 s) | CPU inference | Use a smaller model (`qwen3:4b`), or a GPU build of Ollama |
| Answers are incoherent | Model too small for the task | 8B is the practical floor for tool use; 14B is noticeably better |
| `ERR_MODULE_NOT_FOUND` after updating | Stale app copy | Re-run `./install.sh` |
| Everything is broken | — | `mox doctor`, then `./install.sh` again; both are safe to repeat |

Collect diagnostics if you are reporting a bug:

```bash
mox doctor > ~/mox-diag.txt 2>&1
mox --version >> ~/mox-diag.txt
lsb_release -a >> ~/mox-diag.txt
uname -a >> ~/mox-diag.txt
```

---

## Optional — the from-scratch model

This is the small neural network trained on your folder, described in
`docs/SELF.md`. It needs no model server and no GPU, just CPU and a couple of
minutes.

```bash
mox self train ~/mox-assistant --steps 500
mox self talk ~/mox-assistant
```

It babbles in the style of your writing. It is not the assistant, and it is not
meant to answer questions — it is proof that the training code in this repo
works, and a toy you own outright.

---

## Updating

```bash
cd ~/mox
git pull
./install.sh          # safe to re-run; replaces the app copy
```

Your `~/mox-assistant` folder, its memories, and your `~/.profile` are left
alone.

When pull request #3 is merged into `main`, you can switch permanently:

```bash
cd ~/mox && git checkout main && git pull && ./install.sh
```

---

## Uninstalling

```bash
cd ~/mox && ./install.sh --uninstall
rm -rf ~/mox-assistant          # your assistant's files (optional, irreversible)
rm -rf ~/mox                    # the source checkout
```

That removes the launcher, the app copy, and the menu entry. It leaves alone:
the `PATH` line in `~/.profile`, the `bubblewrap` package, Ollama and its
models, and any `.mox/` run logs inside your projects. Remove Ollama separately
with `sudo apt remove ollama` if you want it gone.
