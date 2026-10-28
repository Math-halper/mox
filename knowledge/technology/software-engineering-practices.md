# Software engineering practices

Programming fundamentals covers language building blocks. This document is about building systems that keep working: version control, testing, review, deployment, and the habits that prevent a codebase from collapsing under its own weight.

## Version control with git

Git stores snapshots of a project as commits, each pointing to its parent, so any state is recoverable.

Everyday vocabulary:

- Repository: the project plus its full history.
- Commit: a snapshot with a message and author.
- Branch: a movable pointer to a commit, used for work in progress.
- Merge: joins two lines of history; conflicts happen where both changed the same lines.
- Rebase: replays commits on a new base, producing a straight history; never rebase a branch others are using.
- Remote: another copy, usually `origin`. Push sends commits; pull fetches and merges; fetch alone only downloads.
- Tag: a permanent name for a release.

Good commits are small, do one thing, and explain why. A useful message says what changed and why it was needed, not "fixes". Pull requests are where review and discussion happen.

## Testing

Tests that are not run are decoration. Three levels matter:

- Unit tests: one function or module, fast, with edges and error cases.
- Integration tests: several parts together, including the database or HTTP layer.
- End-to-end tests: the system from the user's point of view, slow and brittle, so keep few but keep important ones.

Practices that pay:

- Test the behaviour, not the implementation, so refactors do not break the suite.
- Reproduce a bug with a failing test before fixing it.
- Keep tests deterministic: no sleeping, no real network, fixed clocks and seeds.
- Watch for tests that pass for the wrong reason; assert on the value, not just that it is truthy.
- Track coverage as a hint about blind spots, not as a target.

## Review and code quality

A reviewer should check: does it do what it claims, are the edge cases handled, is it understandable in six months, is it tested, and does it break anything else.

Names matter more than style debates. A function called `loadOrCreateSession` saves the next reader minutes. Keep functions small and give them one reason to exist. Prefer flat control flow with early returns. Avoid deep nesting and clever one-liners. Comment the why, let the code say what.

Do not repeat yourself where meaning is shared, but do not merge unrelated things just because they look alike: a little duplication beats a bad abstraction.

## Design principles

- Single responsibility: one module, one job.
- Explicit interfaces: small functions, clear inputs and outputs, errors as values where appropriate.
- Separation of concerns: business rules should not live inside the UI or the database.
- Fail loudly in development, fail gracefully in production, and never lose data silently.
- Backwards compatibility is a feature: when changing a format or API, migrate rather than break.
- Idempotency: retries should not create duplicates; use keys and unique constraints.

## APIs

REST treats resources with HTTP verbs: GET reads, POST creates, PUT or PATCH updates, DELETE removes. Status codes carry meaning: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 503. Return errors as structured data with a message and a code, never as an ambiguous 200.

Version APIs before you need to. Paginate collections; do not return unbounded lists. Rate limit and document limits. Make retries safe. Prefer ids that cannot be guessed for anything private.

## Databases and migrations

Schema changes must be applied in order and recorded (migrations), so any environment can be rebuilt. Prefer additive changes: add a column with a default, backfill, then switch writes, then remove the old column. Large tables need care — a lock during a backfill can take a site down. Indexes speed reads and slow writes; index what you filter and join on, not everything.

## Deployment

Continuous integration runs builds and tests on every push; continuous delivery keeps every commit releasable; continuous deployment ships automatically. Whatever the label, the important parts are:

- One reproducible build artefact.
- Environment-specific configuration outside the code, never credentials in the repository.
- Health checks and rolling or blue-green releases so users never hit a half-updated system.
- Feature flags to decouple deploy from release.
- A rollback path you have actually tested.

## Observability and incidents

Logs, metrics, and traces answer different questions: what happened, how much, and where the time went. Log events, not individual loop iterations, and never log secrets or personal data.

When something breaks: declare the incident, assign one coordinator, gather facts before theories, mitigate first and diagnose second, communicate on a schedule, then write it up. A blameless post-mortem that identifies a missing test, alert, or guardrail is worth more than a culprit.

## Working with others

Smaller changes land faster and are safer. Write down decisions in the repository so they survive people leaving. Automate anything done more than twice. Ship in small slices, measure, iterate. Estimates get better when work is broken down and uncertainty is named, and worse when they are converted into promises.

## Legacy code

You will spend most of your career reading code written by others. Change it in steps: add a test around the behaviour you are about to touch, refactor without changing behaviour, then change behaviour. "If it works, do not touch it" is fine until the next feature needs it; keep the seams where you can add them.
