# Mathematics II: functions, logs, sequences, and discrete math

Mathematics I documents cover arithmetic, algebra, geometry, calculus, statistics, and a formula reference. This companion fills the gaps that come up in later study: functions and their families, exponentials and logarithms, sequences and series, complex numbers, vectors and matrices, and the discrete mathematics behind algorithms.

## Functions

A function maps each input in its domain to exactly one output. Notation: f(x) = 2x + 1. The domain is what you are allowed to put in; the range is what can come out.

Transformations, starting from y = f(x):

- y = f(x) + k shifts up by k.
- y = f(x − h) shifts right by h.
- y = −f(x) reflects over the x-axis; y = f(−x) over the y-axis.
- y = a·f(bx) stretches vertically by a and horizontally by 1/b.

Even functions satisfy f(−x) = f(x) and are symmetric about the y-axis (x², cos x). Odd functions satisfy f(−x) = −f(x) and have rotational symmetry (x³, sin x).

Composition, (f ∘ g)(x) = f(g(x)), is not commutative. An inverse f⁻¹ undoes f and exists only when f is one-to-one; its graph is the reflection across y = x. For a linear function, f(x) = mx + b gives f⁻¹(x) = (x − b)/m.

## The families worth recognising

- Linear: y = mx + b, constant slope.
- Quadratic: y = ax² + bx + c, a parabola; vertex at x = −b/2a.
- Polynomial: sum of power terms; degree gives at most n − 1 turning points and n roots over the complex numbers.
- Rational: ratio of polynomials, with vertical asymptotes where the denominator is zero and horizontal asymptotes from the degree comparison.
- Exponential: y = a·bˣ, growth (b > 1) or decay (0 < b < 1).
- Logarithmic: the inverse of exponential, grows without bound but ever more slowly.
- Trigonometric: periodic; sin and cos have period 2π, amplitude 1.
- Absolute value, square root, and step functions fill in the rest.

## Exponentials and logarithms

Rules: bᵐ·bⁿ = bᵐ⁺ⁿ, bᵐ/bⁿ = bᵐ⁻ⁿ, (bᵐ)ⁿ = bᵐⁿ, b⁰ = 1, b⁻ⁿ = 1/bⁿ, b^(1/n) = ⁿ√b.

A logarithm answers "what exponent gives this?" — log_b(x) = y means bʸ = x. Useful identities:

- log(xy) = log x + log y
- log(x/y) = log x − log y
- log(xⁿ) = n log x
- log_b(x) = ln x / ln b (change of base)
- ln e = 1, log 1 = 0

Applications: compound interest A = P(1 + r/n)^(nt) and continuous growth A = Pe^(rt); radioactive half-life; pH; decibels (a factor of 10 in power is 10 dB); Richter magnitude; algorithmic complexity (a binary search is O(log n) because it halves the problem).

Careful: log(a + b) is not log a + log b, and (a + b)² is not a² + b².

## Sequences and series

Arithmetic sequence: constant difference d; nth term a_n = a₁ + (n − 1)d; sum S_n = n(a₁ + a_n)/2.

Geometric sequence: constant ratio r; nth term a_n = a₁·r^(n−1); sum of n terms S_n = a₁(1 − rⁿ)/(1 − r) for r ≠ 1. An infinite geometric series converges when |r| < 1 to a₁/(1 − r).

A series converges if its partial sums approach a limit. The harmonic series 1 + 1/2 + 1/3 + … diverges even though its terms shrink to zero; Σ1/n² converges. Standard tests: divergence (terms do not go to zero), comparison, ratio, integral, and alternating series.

## Complex numbers

i² = −1. A complex number z = a + bi has real part a, imaginary part b, modulus |z| = √(a² + b²), and argument θ = atan2(b, a). Polar form z = r(cos θ + i sin θ) = re^(iθ), which makes multiplication easy: multiply moduli, add angles. Euler's identity e^(iπ) + 1 = 0 follows. The complex conjugate of a + bi is a − bi, and dividing by a complex number means multiplying top and bottom by its conjugate.

## Vectors and matrices

A vector has magnitude and direction; in components, v = (v₁, v₂, v₃). Addition is component-wise. The dot product u·v = Σuᵢvᵢ gives |u||v|cos θ, so it tests perpendicularity (zero dot product) and projects one vector onto another. The cross product in three dimensions gives a perpendicular vector and measures area.

A matrix is a rectangular array acting on vectors. Multiplication is row-by-column and is not commutative. The identity matrix leaves vectors unchanged; the inverse A⁻¹ exists when the determinant is non-zero and satisfies AA⁻¹ = I. Eigenvalues λ satisfy Av = λv for a non-zero eigenvector v: directions the transformation only stretches. Linear systems are solved by elimination, substitution, or matrix methods, and appear everywhere from graphics transforms to least-squares fitting and machine learning.

## Discrete mathematics

- Sets: union, intersection, difference, complement; subsets; cardinality. A set with n elements has 2ⁿ subsets.
- Logic: and, or, not, implication (p → q is false only when p is true and q is false), contrapositive (equivalent), converse (not equivalent). De Morgan's laws: ¬(p ∧ q) = ¬p ∨ ¬q.
- Proof: direct, contradiction, contrapositive, induction (base case plus the step from n to n + 1), and counterexample.
- Counting: the multiplication principle; permutations nPr = n!/(n − r)!; combinations nCr = n!/(r!(n − r)!).
- Pigeonhole principle: more pigeons than holes forces a shared hole.
- Graphs: vertices and edges; paths, cycles, trees, and degree. A tree on n vertices has exactly n − 1 edges. Shortest paths (Dijkstra), traversal (BFS for fewest edges, DFS for structure), and colouring (scheduling, maps) are the practical core.
- Modular arithmetic: a ≡ b (mod m); clocks, checksums, hashing, and cryptography all live here.

## Growth rates and why they matter

For large n: log n < √n < n < n log n < n² < n³ < 2ⁿ < n!. An algorithm that is O(n log n) beats O(n²) decisively at a million items; an exponential algorithm is only usable for tiny inputs. Choosing the right structure — hash map for lookup, sorted array for binary search, heap for the smallest item, queue for breadth-first — is often a bigger win than micro-optimising code.

Big-O notation describes an upper bound on how running time or memory grows with input size, ignoring constants: O(1) constant, O(log n) halving, O(n) one pass, O(n log n) efficient sorting, O(n²) nested loops, O(2ⁿ) brute-force subsets. Big-Theta gives a tight bound and Big-Omega a lower bound. Doubling the input under O(n²) quadruples the work, which is why an O(n log n) sort finishes in seconds where an O(n²) sort takes hours on the same data. Amortised analysis explains why a dynamic array's occasional resize still averages O(1) per append, and space complexity counts memory the same way.
