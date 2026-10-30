# Git and GitHub automation done safely

Git records history in a folder. GitHub hosts that folder and adds issues, pull requests, reviews, CI, releases, and permissions. Automating both means knowing which half needs a login, which half is irreversible, and what never to print.

## The two halves

| Task | Local Git | GitHub API / CLI |
| --- | --- | --- |
| Inspect history | `git log`, `git diff`, `git status` | commit lists, compare endpoints |
| Branches | create, switch, delete, stash | branch protection rules |
| Sync | `fetch`, `pull`, `push` | — |
| Review work | — | issues, pull requests, reviews, checks |
| Automate | hooks | Actions workflows and runs |
| Publish | tags | releases and uploaded assets |

Reading public repositories needs no credentials. **Writing** — pushing, commenting, closing, merging, rerunning CI — happens as an authenticated user and therefore needs a token or an authenticated CLI.

## REST first, CLI for writes

The REST API is stable, scriptable, and read-heavy: repository metadata, file contents, issues, pull requests, check runs, releases. It is a good choice for lookups because it needs no local installation.

The `gh` CLI carries the user's own login and handles the fiddly parts of writes: creating a pull request with a body, requesting reviewers, uploading release assets. Mixing the two is normal: read with REST, write with `gh`. Check for `gh` first and degrade to a "log in to do this" message rather than failing with a 401 the model then tries to "fix".

Useful REST shapes:

- `GET /repos/{owner}/{repo}/pulls/{number}` — state, mergeability, head/base.
- `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` — CI status per job.
- `GET /repos/{owner}/{repo}/actions/runs?branch=…` — workflow runs, with `status` and `conclusion`.
- `GET /repos/{owner}/{repo}/releases/latest` — assets and their sizes.
- `GET /search/repositories?q=…` — discovery, rate-limited hard when unauthenticated.

Rate limits are the practical constraint: 60 requests an hour anonymously, 5,000 with a token. A 403 after a burst usually means "rate limited", not "forbidden" — say so, and suggest logging in.

## Working inside a clone

The most useful convenience in an automation tool is context: when the working directory is a Git repository, `owner/repo` can be read from the `origin` remote, so commands need not repeat it.

```bash
git remote get-url origin        # git@github.com:owner/repo.git or https://github.com/owner/repo
```

Parse both forms. If there is no `origin`, ask for `owner/repo` explicitly instead of guessing — a wrong guess writes to someone else's repository.

## Irreversible actions need a gate, not a flag

- **Merging a pull request** requires a typed confirmation, in every channel. Not auto-approvable, not available from piped input.
- **Force-pushing** and **deleting branches** should be off by default, and described in the confirmation.
- **Deleting repositories** is best left unimplemented. An action that does not exist cannot be talked into existing by a confused model.
- **Creating** resources should default to the private, draft, or unmerged option: private repositories, draft pull requests, draft releases.
- **CI reruns and cancellations** are cheap but noisy; confirm them like other writes.

The pattern: reads are silent, ordinary writes ask once, destructive actions require typing a word, and catastrophic actions do not exist.

## Secrets

- Never print a token, never echo it into a command, and never put it in a prompt shown to a model.
- Prefer the authenticated CLI over passing `GITHUB_TOKEN` around; if a token is used, read it from the environment at the moment of the call and pass it in a header, not in a URL.
- Scrub tokens from the environment of any subprocess a model can start.
- Auth status is a read: reporting "logged in as X" is safe; reporting `gh auth token` is not.
- If a token leaks into a log, revoke it. Treat it as public.

## Reading CI like a human

Ask three questions in order:

1. **Did it run?** A missing check is not a green check. Look for the workflow run and its conclusion.
2. **What failed?** Fetch the failing job's log, not the whole transcript; the last error usually names the file and the line.
3. **Is it flaky?** The same commit passing on a rerun is evidence of flakiness, not of a fix. Flaky tests should be fixed or quarantined, not rerun forever.

`gh run view --log-failed` and `gh pr checks` are the two commands that do most of this work.

## Commit and pull-request hygiene worth automating for

- One logical change per commit; the message says *why*, not *what the diff already shows*.
- Small pull requests get reviewed; enormous ones get skimmed.
- A PR body should state the problem, the approach, and how it was tested. "Fixes #12" links the issue.
- Reviewing your own change an hour later finds more than reviewing it immediately.
- Never rewrite history that other people have based work on without telling them.

## Scripting recipes

**Check what a branch would do:**

```bash
git fetch origin
git log --oneline origin/main..HEAD     # commits not on main yet
git diff --stat origin/main...HEAD     # files that would change
```

**Find the failing job, not the noise:**

```bash
gh pr checks 42 --watch
gh run view --log-failed
```

**Create a release with an asset:**

```bash
gh release create v1.2.0 ./dist/app.zip --title "v1.2.0" --notes-file CHANGELOG.md --draft
```

**Open a pull request from the current branch:**

```bash
git push -u origin HEAD
gh pr create --fill --draft
```

## What to tell a model that is doing this

Give it the constraints, not just the commands: reads are free, writes are confirmed, merges need a typed `YES`, repository deletion is unsupported, and tokens are never displayed. A model that knows the rule stops trying to route around it — and when it does go off track, the confirmation prompt is where you catch it.
