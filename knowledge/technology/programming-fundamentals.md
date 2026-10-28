# Programming fundamentals

Programming means writing precise instructions that a computer can follow. The language changes; the concepts repeat.

## Building blocks

- Variables hold values: numbers, text (strings), true/false (booleans), lists, and structured records (objects, dictionaries).
- Expressions compute values; statements do things.
- Conditionals branch: if / else if / else.
- Loops repeat: for (a known range or collection), while (until a condition changes).
- Functions take inputs (parameters), do work, and may return a value. Functions should do one thing and be named for that thing.
- Data structures: arrays/lists (ordered), sets (unique), maps/dictionaries (key → value), stacks (last in, first out), queues (first in, first out), trees, and graphs.

## Program structure

Most real programs are organized into modules, classes or types, and layers. Ideas worth naming:
- Abstraction: hide detail behind a clear interface.
- Encapsulation: keep internal state private.
- Composition: build features from small pieces.
- Separation of concerns: each part has one responsibility.
- Pure functions: same input, same output, no side effects — easy to test.
- Immutability: prefer creating new values over mutating shared ones.

## Algorithms and complexity

Common operations: searching (linear, binary), sorting (merge, quicksort, insertion), recursion, dynamic programming, graph traversal (breadth-first, depth-first), and hashing.

Big-O describes how runtime grows: O(1) constant, O(log n) binary search, O(n) one pass, O(n log n) good sorting, O(n²) nested loops. Hashing gives average O(1) lookup but requires a good hash function and memory.

## Errors and debugging

- Syntax error: the code cannot be parsed.
- Runtime error: it crashes while running (null, division by zero, out of range).
- Logic error: it runs but gives wrong results — the hardest kind.
Debug by reproducing reliably, narrowing the problem in half, reading the actual error message and stack trace, printing or logging intermediate values, and testing one change at a time. A debugger lets you pause and inspect state.

## Testing

- Unit test: one small piece in isolation.
- Integration test: several parts together.
- End-to-end test: the whole flow as a user would do it.
- Regression test: guards against a bug returning.
Good tests are fast, deterministic, and independent. Write tests for edge cases: empty input, one item, huge input, invalid data, and boundaries.

## Version control

Git records snapshots (commits) of a project. A branch isolates work; merging combines it. Core loop: change files, stage, commit with a clear message, push, open a pull request, review, merge. Commits should be small and coherent. Never commit secrets.

## Data formats and APIs

JSON is the common exchange format: objects `{}`, arrays `[]`, strings, numbers, booleans, null. YAML is indentation-based and common in configuration. APIs are contracts; document inputs, outputs, and errors. Handle failures: timeouts, retries with backoff, and rate limits.

## Working with files and state

Reading and writing files requires handling encodings (UTF-8 by default) and paths. State stored in memory is lost on exit; persisted state belongs in files or databases. Concurrency bugs (races) happen when two code paths touch shared state; locks, queues, and atomic operations prevent them.

## Practical habits

- Name things clearly; short names are only fine in tiny scopes.
- Keep functions small enough to read on one screen.
- Comment why, not what.
- Fail loudly in development; handle errors gracefully for users.
- Avoid premature optimization; measure before changing.
- Prefer readable code over clever code.
- Learn to read documentation and error messages — that is most of the skill.

## Language families

- JavaScript/TypeScript: browsers, servers with Node.js, dynamic types; TypeScript adds static types.
- Python: readable, strong for data, scripting, and machine learning.
- Java, C#, Go: statically typed, common in large systems.
- C, C++, Rust: manual or strict memory control, systems and performance.
- SQL: declarative queries over relational data.
- HTML/CSS: markup and styling, not general programming but essential for the web.
