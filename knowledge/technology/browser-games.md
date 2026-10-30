# Classic browser games: mechanics and real reference implementations

A web game is a loop, a canvas, and a little state. The classics are worth studying because each one isolates a different technique: grids, physics, spawning, or procedural levels. Each game below names a real, public implementation you can open and read.

## The loop everything shares

```js
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);   // clamp: a paused tab must not teleport the player
  last = now;
  update(dt);      // physics, input, collisions
  render();        // draw from state; never mutate in here
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- **Fixed timestep for physics**, variable timestep for rendering: accumulate `dt` and step the simulation in equal slices (1/60 s) so collisions behave the same on a 144 Hz monitor.
- **Clamp `dt`** — after a tab is backgrounded, the first frame can report seconds of elapsed time and fling the player through a wall.
- **State separate from drawing.** `update()` owns numbers; `render()` only reads them. This is what makes a game testable and pausable.
- **Input as intent, not events.** A keydown sets `jumpRequested = true`; the update step consumes it. Dropped frames then cannot swallow a jump.

## 2048 — grids, slide-and-merge

The original is **gabrielecirulli/2048** (MIT, ~13k stars), the game that produced a thousand variants.

- State: a 4×4 grid of powers of two, plus a score.
- Move: take the row in the direction of travel, drop the zeros, merge equal neighbours *once per move* (walking from the leading edge so a merged pair cannot merge again), then pad with zeros.
- Spawn: after a successful move, place a 2 (90%) or 4 (10%) in a random empty cell.
- Game over: no empty cell **and** no equal orthogonal neighbours.
- Rendering: the original animates tiles as absolutely positioned elements with CSS transitions rather than drawing to a canvas — a good reminder that a canvas is not mandatory.
- Worth copying: `move()` returns whether anything changed, so spawning and the game-over check hang off that one boolean.

## Tetris — rotation systems and line clears

**jakesgordon/javascript-tetris** (MIT) is a compact reference; the mechanics are the same everywhere.

- The board is a 10×20 matrix; each piece is a small matrix of cells plus a rotation state.
- Gravity is a timer, not a velocity: every *drop interval* the piece moves down one row. Speed is the interval, and it shortens as the level rises.
- Lock delay: a piece that lands gets a short grace period before it locks, which is the difference between a forgiving game and a cruel one.
- Rotation should use **SRS** (Super Rotation System) wall kicks — when a rotation would collide, try the five standard offsets before refusing.
- Line clear: find full rows, remove them, shift everything above down, add score by the number of rows at once (1/2/3/4 lines are worth far more than four separate singles).
- Seven-bag randomiser: shuffle all seven pieces and deal them, then reshuffle. Pure random produces droughts that feel broken.

## Snake — the grid game

**dom96/snake** (MIT) shows the whole idea in a few hundred lines.

- State: an array of cells (head first), a direction, and a food cell.
- Each tick: compute the new head, reject reversals, check the wall and the body (`snake.slice(0, -1).includes(head)`), unshift the head, and pop the tail unless food was eaten.
- Ticks are on a timer, not per frame — the speed is the tick interval, and eating can shorten it.
- Queue inputs: if the player presses two directions inside one tick, the second must not become a reversal of the first.

## Breakout — collision and juice

**soundanalogous/Breakout** (MIT) is a straightforward canvas version.

- Paddle angle decides the bounce: `dx = (ball.x - paddle.center) / (paddle.width / 2) * maxAngle` — hitting the edge sends the ball wide.
- Only reflect when the ball is moving *toward* the surface, or it can stick inside a brick and jitter.
- Circle-versus-rectangle is easiest as "clamp the circle's centre to the rect, measure the distance, compare to the radius".
- Brick grids are a 2-D array with a `hitsRemaining` per brick; a brick with 0 is skipped in collision and drawing.

## Flappy Bird — constant acceleration, brutal feedback

**nebez/floppybird** (Apache-2.0) is a faithful browser clone.

- One variable: `velocity`. Each frame `velocity += gravity * dt; y += velocity * dt;` and a flap sets `velocity = -impulse`.
- Collision is `y < ceiling || y + height > ground || rectsOverlap(bird, pipe)`.
- Pipes are spawned on a distance interval, not a time interval, so the rhythm stays constant when speed changes.
- The game is hard because the impulse and the gap are tuned, not because the code is complex. Difficulty is a constant.

## The Chrome dino — procedural obstacles

**wayou/t-rex-runner** (BSD-3-Clause) is the runner extracted from Chromium.

- The dino runs in place; obstacles scroll left at a speed that rises with the score.
- Spawning is a **minimum gap** in distance plus a random extra, which guarantees the player always has a reachable landing.
- Clouds and ground texture scroll at fractions of the obstacle speed — parallax for almost no cost.
- Ducking changes the hitbox, which is why the dino's collision box is stored separately from its sprite.

## Pac-Man — tile grids and greedy ghosts

**luciopanepinto/pacman** (GPL-3.0) is a browser implementation.

- The maze is a tile map; movement is snapped to tiles with a small tolerance so corners are forgiving.
- Pellets are a set of tile coordinates; eating removes one entry and increments the score.
- Ghost behaviour is a target tile plus a pathfinding step: Blinky targets the player, Pinky targets four tiles ahead, Inky uses a vector from Blinky, Clyde switches between chase and scatter by distance.
- Scatter/chase phases run on a timer, and frightened mode reverses direction at every ghost — that single rule is most of the game's feel.

## Tower defence — data-driven waves

**pshenok/server-survival** (MIT, ~6.5k stars) is a tower-defence game about cloud architecture.

- Enemies follow a **path** defined once as a list of waypoints; each enemy stores its distance along that path rather than x/y, so speed changes and knockback are trivial.
- Towers are data: range, fire rate, damage, cost. Adding a tower type means adding a row.
- Waves are data too: a list of `{type, count, interval}`, spawned by a scheduler.
- The interesting part for a learning game is the mapping between mechanics and the thing being taught: "add a load balancer" is a tower, "traffic spike" is a wave.

## Hextris and friends — puzzle variants

**Hextris/hextris** (source-available; check the licence file before reuse) rotates a hexagonal well. The lesson is general: a Tetris-like game does not need a rectangular board — the grid can be polar, and the merge rule can be "three colours in a row" instead of "a full line".

## How to study one of these quickly

1. Open the repository and find the main loop (search for `requestAnimationFrame`, `setInterval`, or a `tick`).
2. Find the state object — everything the game needs to be saved lives there.
3. Find the one rule that makes it feel like itself (merge once, seven-bag, paddle angle, fixed gap, ghost targeting).
4. Copy the rule, not the code. A 60-line version you understand beats a 3,000-line version you pasted.

## Shipping a browser game on a website

- **Canvas, not DOM**, once there are more than a few hundred moving things; DOM wins for grid puzzles like 2048.
- **Cache the sprites**, keep audio off until the first click (autoplay rules), and provide keyboard *and* touch input.
- **Save progress in local storage**, versioned under one key, and offer a reset.
- **Pause on `visibilitychange`**, or the player returns to a game that ran for ten minutes without them.
- **Keep the loop running through a fixed-timestep accumulator** so a slow laptop plays the same game, just choppier.

## A word on the legal side

Fan ports and mirrors of commercial games — Mario, Celeste, Minecraft clients, Flash-era adventure games — are widely distributed and still not licensed for redistribution. Open-source originals (2048, the Tetris clone, Snake, Breakout, Flappy Bird, the Chromium dino) are safe to learn from and, with their licences respected, to ship. When in doubt: read the licence file, and if there is none, do not redistribute.
