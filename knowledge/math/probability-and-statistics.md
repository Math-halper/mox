# Probability and statistics

Probability measures how likely an event is; statistics turns data into summaries and decisions.

## Basic probability

Probability of an event = favorable outcomes / total equally likely outcomes. Values run from 0 (impossible) to 1 (certain). The complement rule: P(not A) = 1 − P(A).

Addition rule: P(A or B) = P(A) + P(B) − P(A and B). For mutually exclusive events the overlap is zero.

Multiplication rule: P(A and B) = P(A) × P(B|A). For independent events, P(A and B) = P(A) × P(B).

Example: rolling a die, P(even) = 3/6 = 0.5. Drawing two aces from a standard 52-card deck without replacement: (4/52) × (3/51) ≈ 0.0045.

## Conditional probability and Bayes

P(A|B) = P(A and B)/P(B). Bayes' theorem: P(A|B) = P(B|A)P(A) / P(B). It updates a prior belief with new evidence. A disease test with 99% accuracy applied to a rare disease still yields many false positives, because the prior is tiny.

## Counting

- Fundamental counting principle: multiply choices for independent stages.
- Permutations (order matters): nPr = n!/(n − r)!.
- Combinations (order does not matter): nCr = n!/(r!(n − r)!), also written C(n, r).
- With repetition allowed, k choices for n slots gives kⁿ.

## Random variables and distributions

- Expected value (mean of a random variable): E(X) = Σ x·P(x).
- Variance: Var(X) = E(X²) − [E(X)]²; standard deviation is its square root.
- Binomial distribution: fixed number n of independent trials, two outcomes, probability p. Mean np, variance np(1 − p). P(k successes) = C(n, k)pᵏ(1 − p)ⁿ⁻ᵏ.
- Normal distribution: symmetric bell curve defined by mean μ and standard deviation σ. About 68% of values fall within one σ, 95% within two, 99.7% within three. Standardize with z = (x − μ)/σ.
- The mean of many independent samples is approximately normal (central limit theorem), which is why averages behave predictably.

## Describing data

- Mean: sum divided by count; sensitive to outliers.
- Median: middle value when ordered; robust to outliers.
- Mode: most frequent value.
- Range: max − min. Interquartile range (IQR) = Q3 − Q1 and holds the middle 50% of data.
- Outlier rule of thumb: below Q1 − 1.5·IQR or above Q3 + 1.5·IQR.
- Variance of a sample: Σ(x − x̄)²/(n − 1); standard deviation is its square root.

## Bias and study design

- Random sampling reduces selection bias.
- Observational studies find associations; only randomized controlled experiments support causal claims.
- Common biases: survivorship bias, response bias, convenience sampling, leading questions.
- Confounding variables can create a correlation that has no causal link. "Correlation does not imply causation" is the shorthand.

## Correlation and regression

Pearson's r runs from −1 to 1 and measures the strength of a linear relationship. A regression line y = a + bx minimizes squared error, with b = r(s_y/s_x). Correlation is not affected by changing units, but it only captures linear patterns and is sensitive to outliers.

## Statistical inference

- A confidence interval estimates a population parameter with a margin of error. A 95% interval means the procedure captures the true value in about 95% of repeated samples.
- Hypothesis testing compares data to a null hypothesis. The p-value is the probability of data at least this extreme if the null were true; it is not the probability that the null is true.
- A small p-value is evidence against the null, but effect size and study design matter more than a threshold such as 0.05.
- Type I error: rejecting a true null (false positive). Type II error: failing to reject a false null (false negative). Power is 1 minus the Type II error rate.

## Probability traps

- Gambler's fallacy: past independent results do not change future odds.
- The law of large numbers means long-run averages approach the expected value, not that short runs even out.
- The birthday problem: with 23 people there is already about a 50% chance two share a birthday, because there are 253 pairs, not 23 chances.
