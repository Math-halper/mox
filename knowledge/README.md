# knowledge/ — the built-in library

This folder is the reference library Mox reads. Every `.md`, `.txt`, `.pdf`, `.csv`, `.json`, `.html`, `.xml`, `.yaml`, and `.log` file here is fetched by the page, split into overlapping passages of about 800 characters, and indexed in the visitor's browser. When someone asks a question, the app scores the passages against the question's terms and places the best matches in the model's prompt as numbered sources, which answers cite as `[1]`, `[2]`, and so on.

## Contents

55 documents, roughly 56k words:

| Folder | Subject | Documents |
| --- | --- | ---: |
| `math/` | Arithmetic, algebra, geometry, trigonometry, calculus, probability, statistics, formula reference | 7 |
| `reading/` | Comprehension, grammar, punctuation, writing, style, vocabulary, literature, rhetoric | 6 |
| `technology/` | Computers, the internet, the web, popular websites, programming, AI, local agents and tool use, browser runtimes and GGUF, small open models, browser games, emulators and Flash, website design references, a line-of-code reference, security, data and SQL, software engineering, Git and GitHub automation, browser desktops, charts, SVG, full HTML/CSS/JavaScript/API references | 24 |
| `science/` | Physics, chemistry, biology and Earth science, astronomy and space | 6 |
| `humanities/` | World history, geography and cultures, philosophy, modern history | 5 |
| `life/` | Health, personal finance, study skills, careers, law and civics, cooking and food safety | 6 |
| `mox-starter-guide.md` | How this app works, and what it can do | 1 |

## How retrieval works

Each document is chunked into overlapping passages. On a question, passages are scored with IDF-weighted term matches, suffix stemming (so "fraction" finds "fractions"), a coverage bonus for answering the whole question, and a phrase bonus when consecutive question words appear together. Question words are also expanded with a small synonym table — "website" brings in "web", "site" and "html" at half weight — which helps short questions land on the right document. Passages beneath a relevance floor are discarded — a weak match is worse than none, because it can lead the model to cite an irrelevant passage. When passages match, the model answers from them and may add general knowledge; when nothing matches, it answers from its own knowledge and a note under the reply says so.

## Credit

Three of the technology documents — `local-ai-agents-and-tools.md`, `git-and-github-automation.md` and `desktop-shell-in-the-browser.md` — were distilled from the architecture of the repository author's own projects, [BOOTMILELIK](https://github.com/Math-halper/BOOTMILELIK) and [math-halper.github.io](https://github.com/Math-halper/math-halper.github.io). The rest of this library leans on the wider open-source stack the site runs on (wllama, llama.cpp, PDF.js, SmolLM2, Qwen) and on the public documentation of MDN and Wikipedia.

Full credit — including the upstream projects behind those works — lives in the top-level [`README.md`](../README.md#credits).

The documents themselves name neither the projects nor their authors: they describe how such systems work, in general terms, so that retrieval never lands on a page that is really about this site's own family of code. This file is not indexed.

## Limits

Editing a document changes what the model is shown on the next question — nothing else. Nothing here retrains the model. Files are read in the browser and are never uploaded. Files over 12 MB are skipped, and very large PDFs can be slow to parse on first import.
