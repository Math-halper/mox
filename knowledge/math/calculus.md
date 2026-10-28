# Calculus

Calculus studies continuous change. Differential calculus measures instantaneous rates and slopes; integral calculus measures accumulation and area. Both rest on limits.

## Limits

A limit describes the value a function approaches as the input approaches a point, not necessarily the value at that point. Notation: lim(x→a) f(x) = L.

Rules: sums, products, and quotients of limits behave as expected where denominators are nonzero. Indeterminate forms such as 0/0 require algebra (factor and cancel) or L'Hôpital's rule (for 0/0 and ∞/∞, take the derivative of numerator and denominator). A function is continuous at a point when the limit exists, the function is defined there, and the two agree.

## Derivative

The derivative f′(x) is the instantaneous rate of change:
f′(x) = lim(h→0) [f(x + h) − f(x)] / h.

Interpretations: slope of the tangent line, velocity from position, marginal cost from total cost. Notation: f′(x), dy/dx, or Df.

## Differentiation rules

- Constant: d/dx[c] = 0.
- Power: d/dx[xⁿ] = nxⁿ⁻¹ (for example d/dx[x⁵] = 5x⁴, d/dx[√x] = 1/(2√x)).
- Constant multiple: d/dx[c·f] = c·f′.
- Sum: (f + g)′ = f′ + g′.
- Product: (fg)′ = f′g + fg′.
- Quotient: (f/g)′ = (f′g − fg′)/g².
- Chain: d/dx[f(g(x))] = f′(g(x))·g′(x).

Standard derivatives:
- d/dx[eˣ] = eˣ; d/dx[aˣ] = aˣ ln a.
- d/dx[ln x] = 1/x; d/dx[log_a x] = 1/(x ln a).
- d/dx[sin x] = cos x; d/dx[cos x] = −sin x; d/dx[tan x] = sec²x.
- d/dx[arcsin x] = 1/√(1 − x²); d/dx[arctan x] = 1/(1 + x²).

## Applications of derivatives

- Critical points where f′ = 0 or is undefined; test with the first derivative (sign change) or second derivative (concavity).
- f″ > 0 means concave up (local minimum); f″ < 0 means concave down (local maximum).
- Increasing where f′ > 0, decreasing where f′ < 0.
- Related rates: differentiate a relationship with respect to time.
- Optimization: build a function for the quantity, differentiate, solve f′ = 0, then check endpoints.
- Linear approximation: f(x) ≈ f(a) + f′(a)(x − a). Newton's method: xₙ₊₁ = xₙ − f(xₙ)/f′(xₙ).

## Integral

The definite integral ∫ from a to b of f(x) dx is the signed area under the curve, defined as a limit of Riemann sums. The indefinite integral is the family of antiderivatives (plus C).

The fundamental theorem of calculus links the two ideas: if F′ = f, then ∫ from a to b f(x) dx = F(b) − F(a), and d/dx ∫ from a to x f(t) dt = f(x).

## Antiderivatives worth memorizing

- ∫ xⁿ dx = xⁿ⁺¹/(n + 1) + C (n ≠ −1)
- ∫ 1/x dx = ln|x| + C
- ∫ eˣ dx = eˣ + C
- ∫ cos x dx = sin x + C; ∫ sin x dx = −cos x + C
- ∫ sec²x dx = tan x + C
- ∫ 1/(1 + x²) dx = arctan x + C

Techniques: substitution (reverse chain rule), integration by parts ∫u dv = uv − ∫v du, partial fractions, and trigonometric substitution. Definite integrals can also be approximated by trapezoids or Simpson's rule.

## Applications of integrals

- Area between curves: ∫ (top − bottom) dx.
- Volume of revolution: disks π∫[f(x)]² dx; shells 2π∫x·f(x) dx.
- Average value of a function: (1/(b − a))∫ from a to b f.
- Distance from velocity: ∫ v(t) dt; displacement is the same integral of signed velocity.

## Differential equations

An equation involving derivatives. dy/dx = ky has solution y = Ce^(kx) — the model for exponential growth and decay (population, compound interest, radioactive half-life). Separable equations are solved by moving y terms to one side and x terms to the other and integrating.

## Sequences and series (calculus view)

A series converges if its partial sums approach a limit. Geometric series converges when |r| < 1 to a/(1 − r). The p-series Σ1/nᵖ converges when p > 1. Tests include the ratio test, comparison test, integral test, and alternating series test. Taylor series expand a function around a point: f(x) = Σ f⁽ⁿ⁾(a)(x − a)ⁿ/n!. For example eˣ = 1 + x + x²/2! + x³/3! + …
