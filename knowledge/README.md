# The knowledge folder

This folder is the library Mox reads. Every `.md` (or `.txt`, `.pdf`, `.csv`, `.json`) file here is chunked, indexed locally in your browser, and searched when you ask a question. Answers cite the file they came from.

## What is in the starter library

| Folder | Contents | Files |
| --- | --- | --- |
| `math/` | Arithmetic and number sense, algebra, geometry and trigonometry, calculus, probability and statistics, formula reference, functions/logs/discrete math | 7 |
| `reading/` | Reading comprehension, grammar and punctuation, writing and style, vocabulary and word roots, literature and rhetoric, forms and close reading | 6 |
| `technology/` | How computers work, the internet and the web, programming fundamentals, AI and machine learning, cybersecurity and privacy, data and SQL, software engineering practices, web development, **HTML reference, CSS reference, JavaScript reference, APIs/HTTP/JSON** | 12 |
| `science/` | Physics, chemistry, biology and Earth science, astronomy and space, chemistry of reactions and materials, electricity/waves/modern physics | 6 |
| `humanities/` | World history timeline, geography and cultures, philosophy and critical thinking, modern history 1900–today, cities/climate/maps | 5 |
| `life/` | Health and wellbeing, money and personal finance, study skills and learning, careers and interviews, everyday law and civics, cooking and food safety | 6 |

Plus the Mox starter guide at the top level.

Total: 43 documents, roughly 39k words.

The four reference documents are deliberately dense: every common HTML element and
attribute, the CSS property groups and layout systems, the JavaScript language and
standard library plus DOM/events/web APIs, and how HTTP APIs and JSON work. They are
retrieved like any other document, so a question about `grid-template-columns` or
`array.reduce` lands on the reference rather than a summary.

## Adding your own material

Drop files into this folder (or any subfolder) and reload the page, or use **Add a folder** / **Add files** in the app to import from anywhere on your computer. To make a file part of the bundled library that loads automatically, add it to `knowledge/` and run:

```sh
python3 tools/build_knowledge_index.py
```

That regenerates `knowledge/index.json`, the manifest the app fetches on startup.

## How the library is used

The app splits each document into overlapping passages of about 800 characters, scores them against your question's terms (IDF-weighted term matches, suffix stemming, a coverage bonus for answering the whole question, and a bonus when consecutive words appear together), and passes the best passages to the language model as context.

A relevance floor throws away weak matches, because a bad passage makes the model cite nonsense. When passages match, the model answers from them and cites them as `[1]`. When nothing matches, it answers from its own knowledge and the app says so under the reply — it is never told it has "no sources".

Nothing here retrains the model. Editing a document changes what the model is shown on the next question — nothing else. Files are read in your browser; the app never uploads them.

## Formats and limits

PDF, TXT, Markdown, CSV, JSON, HTML, XML, YAML, and LOG. Files over 12 MB are skipped. Very large PDFs can be slow to parse on first import.
