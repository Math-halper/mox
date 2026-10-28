# Data, databases, and SQL

Data work is mostly about structure, accuracy, and asking precise questions.

## Data types and structure

- Qualitative (categorical): labels such as country, color, plan type. Nominal has no order; ordinal has a meaningful order.
- Quantitative: numeric. Discrete values are counted; continuous values are measured.
- Structured data fits tables; semi-structured data is JSON or XML; unstructured data is text, images, and audio.
- Tidy tabular data: one row per observation, one column per variable, one value per cell.

## Data quality checks

Missing values, duplicates, inconsistent units, impossible values, mixed date formats, and outliers. Record every cleaning decision so the analysis is reproducible. Never silently drop data that makes a result less convenient.

## Flat files

CSV is simple and universal but has no types and no standard for escapes. JSON handles nesting. Parquet and similar columnar formats compress well and are fast for analytics. Always keep an untouched copy of raw data.

## Relational databases

Tables with rows (records) and columns (fields), linked by keys. A primary key uniquely identifies a row; a foreign key references another table's primary key. Relationships: one-to-one, one-to-many, many-to-many (through a join table).

Normalization reduces duplication: first normal form removes repeating groups; second removes partial dependencies; third removes transitive dependencies. Denormalization is sometimes deliberate for read speed.

ACID properties: Atomicity (all or nothing), Consistency (valid states), Isolation (concurrent transactions do not interfere), Durability (committed data survives failure).

## SQL essentials

```sql
SELECT name, price
FROM products
WHERE price > 20 AND category = 'tools'
ORDER BY price DESC
LIMIT 10;
```

- Joins: INNER (matches in both), LEFT (all left rows plus matches), RIGHT, FULL OUTER, CROSS.
- Aggregates: COUNT, SUM, AVG, MIN, MAX with GROUP BY and HAVING.
- Filtering with LIKE, IN, BETWEEN, IS NULL.
- Sorting: ORDER BY. Removing duplicates: DISTINCT.
- Changing data: INSERT, UPDATE, DELETE — always use a WHERE clause.
- Structure: CREATE TABLE, ALTER TABLE, indexes for fast lookups, views for saved queries.
- Subqueries and common table expressions (`WITH name AS (...)`) break complex logic into steps.
- Window functions compute running totals and ranks without collapsing rows: `SUM(x) OVER (PARTITION BY group ORDER BY date)`.

## NoSQL families

- Key-value (Redis, DynamoDB): fast lookups by key.
- Document (MongoDB, Firestore): JSON-like records, flexible schema.
- Wide-column (Cassandra, Bigtable): huge distributed tables.
- Graph (Neo4j): nodes and relationships, useful for networks.
- Search engines (Elasticsearch): inverted indexes for text relevance.

Choose based on access patterns. Relational databases remain the default when relationships and consistency matter.

## Indexes and performance

An index is a sorted structure that avoids scanning every row. Trade-off: faster reads, slower writes, more storage. Index columns used in joins, filters, and sorting. Use EXPLAIN to see the query plan. Avoid SELECT * in production and avoid functions wrapped around indexed columns in WHERE clauses.

## Analytics basics

- Mean, median, mode; standard deviation; percentiles.
- Cohort analysis compares groups over time.
- Correlation is not causation; watch for confounders and selection bias.
- Dashboards should show a denominator, a time range, and a definition for every metric.
- Data visualization: choose encodings that match the question; bar charts for categories, line charts for trends, scatter plots for relationships; start axes at zero for magnitudes.

## Privacy and ethics in data

Collect the minimum, aggregate where possible, store securely, and think about who could be harmed by the dataset or its conclusions. Many datasets encode historical bias; the analysis can amplify it.
