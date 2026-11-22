# Sokoban Solver — sokoban-solver-01-run-20261121

A push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/funfunin/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/funfunin/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

## How it works

Every level is a hallway with one to four rooms off it, and a box pushed out
of its room can never come back — so a level's push-optimal count is the sum
of its rooms' optima. The solver exploits that:

1. **Decompose.** Find the hallway (the long floor line through the player),
   then flood-fill from each door to get that room's floor, boxes and goals.
2. **Solve each room** with a push-based A* from its door: states are box
   positions plus the player's reachable region; the heuristic is the minimum
   total box-to-goal distance over all assignments (exhaustive for 3–4
   boxes), and dead squares (cells a box can never be pushed from onto a
   goal) are pruned. The heap breaks ties toward states with more boxes
   already on goals. A room only counts as solved when the player can still
   reach the door afterwards, so it can walk on to the next room.
3. **Walk and concatenate.** Hallway walks between doors are shortest paths
   on open floor, and the rooms' move sequences are joined in hallway order.

If a room's A* exhausts its expansion budget, a greedy best-first search
takes over so the room is still solved (suboptimally) rather than left
unsolved. Budgets are counted in work, never wall-clock time, so two runs
always write byte-identical solutions.

## Practice result

Score **1,000,000** on the practice set — every instance solved in exactly
its push-optimal count:

| instance | pushes | P* |
|----------|--------|----|
| i001 | 13 | 13 |
| i002 | 16 | 16 |
| i003 | 29 | 29 |
| i004 | 47 | 47 |
| i005 | 60 | 60 |

The whole set runs in about half a second, far inside the 60-second wall.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is Node 22, standard library only. It reads
`<input>/<id>/level.txt` for every instance directory and writes
`<output>/<id>/solution.txt` (the player's moves in `u`, `d`, `l`, `r`).
`MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` fall back to `/input` / `/output`.
