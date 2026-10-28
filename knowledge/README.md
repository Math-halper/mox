# The knowledge folder

This folder is the library Mox reads. Every `.md` (or `.txt`, `.pdf`, `.csv`, `.json`) file here is chunked, indexed locally in your browser, and searched when you ask a question. Answers cite the file they came from.

## What is in the starter library

| Folder | Contents | Files |
| --- | --- | --- |
| `math/` | Arithmetic and number sense, algebra, geometry and trigonometry, calculus, probability and statistics, formula reference | 6 |
| `reading/` | Reading comprehension, grammar and punctuation, writing and style, vocabulary and word roots, literature and rhetoric | 5 |
| `technology/` | How computers work, the internet and the web, programming fundamentals, AI and machine learning, cybersecurity and privacy, data and SQL | 6 |
| `science/` | Physics, chemistry, biology and Earth science, astronomy and space | 4 |
| `humanities/` | World history timeline, geography and cultures, philosophy and critical thinking | 3 |
| `life/` | Health and wellbeing, money and personal finance, study skills and learning | 3 |

Total: 27 documents, roughly 20,000 words.

## Adding your own material

Drop files into this folder (or any subfolder) and reload the page, or use **Add a folder** / **Add files** in the app to import from anywhere on your computer. To make a file part of the bundled library that loads automatically, add it to `knowledge/` and run:

```sh
python3 tools/build_knowledge_index.py
```

That regenerates `knowledge/index.json`, the manifest the app fetches on startup.

## How the library is used

The app splits each document into overlapping passages of about 1,000 characters, scores them against your question's terms (a TF-IDF style score plus an exact-phrase bonus), and passes the best passages to the language model as context. The model is told to answer from those passages and name the file; if nothing relevant is found, it is told to say so.

Nothing here retrains the model. Editing a document changes what the model is shown on the next question — nothing else. Files are read in your browser; the app never uploads them.

## Formats and limits

PDF, TXT, Markdown, CSV, JSON, HTML, XML, YAML, and LOG. Files over 12 MB are skipped. Very large PDFs can be slow to parse on first import.
