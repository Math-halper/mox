# knowledge/ — the built-in library

This folder is the reference library Mox reads. Every `.md`, `.txt`, `.pdf`, `.csv`, `.json`, `.html`, `.xml`, `.yaml`, and `.log` file here is fetched by the page, split into overlapping passages of about 800 characters, and indexed in the visitor's browser. When someone asks a question, the app scores the passages against the question's terms and places the best matches in the model's prompt as numbered sources, which answers cite as `[1]`, `[2]`, and so on.

## Contents

43 documents, roughly 39k words:

| Folder | Subject | Documents |
| --- | --- | ---: |
| `math/` | Arithmetic, algebra, geometry, trigonometry, calculus, probability, statistics, formula reference | 7 |
| `reading/` | Comprehension, grammar, punctuation, writing, style, vocabulary, literature, rhetoric | 6 |
| `technology/` | Computers, the internet, the web, programming, AI, security, data and SQL, software engineering, full HTML/CSS/JavaScript/API references | 12 |
| `science/` | Physics, chemistry, biology and Earth science, astronomy and space | 6 |
| `humanities/` | World history, geography and cultures, philosophy, modern history | 5 |
| `life/` | Health, personal finance, study skills, careers, law and civics, cooking and food safety | 6 |

Plus the Mox starter guide at the top level.

## How retrieval works

Each document is chunked into overlapping passages. On a question, passages are scored with IDF-weighted term matches, suffix stemming (so "fraction" finds "fractions"), a coverage bonus for answering the whole question, and a phrase bonus when consecutive question words appear together. Passages beneath a relevance floor are discarded — a weak match is worse than none, because it can lead the model to cite an irrelevant passage. When passages match, the model answers from them and may add general knowledge; when nothing matches, it answers from its own knowledge and a note under the reply says so.

## Limits

Editing a document changes what the model is shown on the next question — nothing else. Nothing here retrains the model. Files are read in the browser and are never uploaded. Files over 12 MB are skipped, and very large PDFs can be slow to parse on first import.
