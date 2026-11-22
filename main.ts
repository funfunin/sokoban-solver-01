// Sokoban solver for make.fun sokoban-solver-01-run-20261121.
//
// Strategy: the level is a hallway with 1-4 rooms off it. Every box stays in
// its room, so the level decomposes: solve each room independently with a
// push-based A* from its door (minimum-assignment heuristic, dead-square
// pruning), then walk the hallway between doors and concatenate the moves.
// Pushes are the only thing scored, so the search minimises pushes; walks
// are plain shortest paths and cost nothing. Fully deterministic: no clock,
// no randomness, fixed expansion budgets.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Expansion budget per room for the optimal A*; the greedy fallback gets its
// own smaller budget. Tuned on the practice set; budgets are work, not time,
// so two runs always agree byte for byte.
const ROOM_BUDGET = 400000;
const GREEDY_BUDGET = 150000;

interface Dir { dy: number; dx: number; ch: string; }
const DIRS: Dir[] = [
  { dy: -1, dx: 0, ch: 'u' },
  { dy: 1, dx: 0, ch: 'd' },
  { dy: 0, dx: -1, ch: 'l' },
  { dy: 0, dx: 1, ch: 'r' },
];
const cell = (y: number, x: number, W: number): number => y * W + x;

interface Level {
  W: number; H: number;
  wall: Uint8Array;          // 1 = wall
  boxes: number[];           // initial box cells
  goals: number[];           // goal cells
  player: number;            // player start cell
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').map((r) => r.replace(/\r$/, ''));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(W * H);
  const boxes: number[] = [];
  const goals: number[] = [];
  let player = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = rows[y][x] ?? '#';
      const i = cell(y, x, W);
      if (c === '#') { wall[i] = 1; continue; }
      if (c === '$' || c === '*') boxes.push(i);
      if (c === '.' || c === '*') goals.push(i);
      if (c === '@' || c === '+') player = i;
    }
  }
  return { W, H, wall, boxes, goals, player };
}

interface Room {
  door: number;              // room-floor cell touching the hallway
  entry: number;             // hallway cell next to the door
  floor: Set<number>;        // room floor cells (door included)
  boxes: number[];           // initial boxes in this room
  goals: number[];           // goals in this room
}

// Find the hallway: the long 1-wide floor line through the player start.
function findHallway(lv: Level): { cells: Set<number>; horizontal: boolean } {
  const { W, H, wall, player } = lv;
  const py = Math.floor(player / W);
  const px = player % W;
  // Horizontal run through the player row.
  let x0 = px; while (x0 - 1 >= 0 && !wall[cell(py, x0 - 1, W)]) x0--;
  let x1 = px; while (x1 + 1 < W && !wall[cell(py, x1 + 1, W)]) x1++;
  if (x1 - x0 + 1 >= Math.ceil(W * 0.6)) {
    const cells = new Set<number>();
    for (let x = x0; x <= x1; x++) cells.add(cell(py, x, W));
    return { cells, horizontal: true };
  }
  // Vertical run through the player column.
  let y0 = py; while (y0 - 1 >= 0 && !wall[cell(y0 - 1, px, W)]) y0--;
  let y1 = py; while (y1 + 1 < H && !wall[cell(y1 + 1, px, W)]) y1++;
  const cells = new Set<number>();
  for (let y = y0; y <= y1; y++) cells.add(cell(y, px, W));
  return { cells, horizontal: false };
}

function flood(lv: Level, start: number, blocked: (c: number) => boolean): Set<number> {
  const seen = new Set<number>([start]);
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const y = Math.floor(c / lv.W);
    const x = c % lv.W;
    for (const d of DIRS) {
      const ny = y + d.dy;
      const nx = x + d.dx;
      if (ny < 0 || ny >= lv.H || nx < 0 || nx >= lv.W) continue;
      const n = cell(ny, nx, lv.W);
      if (seen.has(n) || lv.wall[n] || blocked(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

// Detect rooms: floor cells next to the hallway that flood-fill into a
// region holding boxes and goals. One region = one room.
function findRooms(lv: Level, hallway: Set<number>, horizontal: boolean): Room[] {
  const { W, H, wall } = lv;
  const boxSet = new Set(lv.boxes);
  const goalSet = new Set(lv.goals);
  const cands: { door: number; entry: number }[] = [];
  for (const h of hallway) {
    const y = Math.floor(h / W);
    const x = h % W;
    const sides = horizontal
      ? [{ dy: -1, dx: 0 }, { dy: 1, dx: 0 }]
      : [{ dy: 0, dx: -1 }, { dy: 0, dx: 1 }];
    for (const s of sides) {
      const ny = y + s.dy;
      const nx = x + s.dx;
      if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
      const n = cell(ny, nx, W);
      if (wall[n] || hallway.has(n)) continue;
      cands.push({ door: n, entry: h });
    }
  }
  const rooms: Room[] = [];
  const claimed = new Set<number>();
  for (const c of cands) {
    if (claimed.has(c.door)) continue;
    const floor = flood(lv, c.door, (n) => hallway.has(n));
    for (const f of floor) claimed.add(f);
    const boxes = lv.boxes.filter((b) => floor.has(b));
    const goals = lv.goals.filter((g) => floor.has(g));
    if (boxes.length === 0 || goals.length === 0) continue;
    // The door is the candidate cell; keep the first candidate of the region.
    rooms.push({ door: c.door, entry: c.entry, floor, boxes, goals });
  }
  // Order along the hallway: by column (horizontal) or by row (vertical).
  rooms.sort((a, b) => {
    const ay = Math.floor(a.door / W); const ax = a.door % W;
    const by = Math.floor(b.door / W); const bx = b.door % W;
    return horizontal ? ax - bx : ay - by;
  });
  return rooms;
}

// Shortest walk (move letters) from `from` to `to`; passable decides which
// cells may be stepped on. Null when unreachable.
function bfsPath(lv: Level, from: number, to: number, passable: (c: number) => boolean): string | null {
  if (from === to) return '';
  const N = lv.W * lv.H;
  const prev = new Int32Array(N).fill(-1);
  const prevDir = new Int8Array(N).fill(-1);
  const q = [from];
  prev[from] = from;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const y = Math.floor(c / lv.W);
    const x = c % lv.W;
    for (let di = 0; di < 4; di++) {
      const d = DIRS[di];
      const ny = y + d.dy;
      const nx = x + d.dx;
      if (ny < 0 || ny >= lv.H || nx < 0 || nx >= lv.W) continue;
      const n = cell(ny, nx, lv.W);
      if (prev[n] !== -1 || lv.wall[n] || !passable(n)) continue;
      prev[n] = c;
      prevDir[n] = di;
      if (n === to) {
        let s = '';
        let cur = n;
        while (cur !== from) {
          s = DIRS[prevDir[cur]].ch + s;
          cur = prev[cur];
        }
        return s;
      }
      q.push(n);
    }
  }
  return null;
}

// ---------------- room solver: push-based A* ----------------

interface RoomCtx {
  lv: Level;
  room: Room;
  walkable: Set<number>;     // room floor + entry cell
  distToGoal: Int32Array[];  // per goal: BFS distance over room floor
  dead: Uint8Array;          // 1 = a box here can never reach a goal
  goalSet: Set<number>;
}

// BFS distances from one goal over room floor (boxes ignored).
function goalDistances(lv: Level, room: Room, goal: number): Int32Array {
  const dist = new Int32Array(lv.W * lv.H).fill(-1);
  const q = [goal];
  dist[goal] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const y = Math.floor(c / lv.W);
    const x = c % lv.W;
    for (const d of DIRS) {
      const ny = y + d.dy;
      const nx = x + d.dx;
      if (ny < 0 || ny >= lv.H || nx < 0 || nx >= lv.W) continue;
      const n = cell(ny, nx, lv.W);
      if (dist[n] !== -1 || !room.floor.has(n)) continue;
      dist[n] = dist[c] + 1;
      q.push(n);
    }
  }
  return dist;
}

// Dead squares: a floor cell is live when a box there can be pushed, step by
// step, onto a goal (other boxes ignored). Reverse BFS over the push graph:
// a box at c can move to adjacent floor n when the player can stand behind
// it, at 2c - n, on walkable floor.
function deadSquares(lv: Level, room: Room, walkable: Set<number>): Uint8Array {
  const N = lv.W * lv.H;
  const live = new Uint8Array(N);
  const q: number[] = [];
  for (const g of room.goals) { live[g] = 1; q.push(g); }
  for (let qi = 0; qi < q.length; qi++) {
    const n = q[qi];
    const ny = Math.floor(n / lv.W);
    const nx = n % lv.W;
    for (const d of DIRS) {
      // Box was at c = n - d, pushed in direction d onto n.
      const cy = ny - d.dy;
      const cx = nx - d.dx;
      const by = ny - 2 * d.dy; // cell behind the box
      const bx = nx - 2 * d.dx;
      if (cy < 0 || cy >= lv.H || cx < 0 || cx >= lv.W) continue;
      if (by < 0 || by >= lv.H || bx < 0 || bx >= lv.W) continue;
      const c = cell(cy, cx, lv.W);
      const b = cell(by, bx, lv.W);
      if (live[c] || !room.floor.has(c) || !walkable.has(b)) continue;
      live[c] = 1;
      q.push(c);
    }
  }
  const dead = new Uint8Array(N);
  for (const f of room.floor) if (!live[f]) dead[f] = 1;
  return dead;
}

function makeRoomCtx(lv: Level, room: Room): RoomCtx {
  const walkable = new Set<number>(room.floor);
  walkable.add(room.entry);
  const distToGoal = room.goals.map((g) => goalDistances(lv, room, g));
  const dead = deadSquares(lv, room, walkable);
  return { lv, room, walkable, distToGoal, dead, goalSet: new Set(room.goals) };
}

// Minimum total box-to-goal distance over all assignments (3-4 boxes, so
// exhaustive permutations). Infinity when some box reaches no goal.
function heuristic(ctx: RoomCtx, boxes: number[]): number {
  const n = boxes.length;
  const m = ctx.room.goals.length;
  if (n !== m) return Infinity;
  let best = Infinity;
  const used = new Array<boolean>(m).fill(false);
  const perm = (i: number, sum: number): void => {
    if (sum >= best) return;
    if (i === n) { best = sum; return; }
    for (let g = 0; g < m; g++) {
      if (used[g]) continue;
      const d = ctx.distToGoal[g][boxes[i]];
      if (d < 0) continue;
      used[g] = true;
      perm(i + 1, sum + d);
      used[g] = false;
    }
  };
  perm(0, 0);
  return best;
}

// Player's reachable region from `start` over walkable cells minus boxes.
// Returns the cells and the canonical (smallest) cell, which identifies the
// region: two states with the same boxes and the same canonical cell have
// the same reachable region.
function region(ctx: RoomCtx, start: number, boxSet: Set<number>): { cells: Set<number>; min: number } {
  const cells = new Set<number>([start]);
  const q = [start];
  let min = start;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const y = Math.floor(c / ctx.lv.W);
    const x = c % ctx.lv.W;
    for (const d of DIRS) {
      const ny = y + d.dy;
      const nx = x + d.dx;
      if (ny < 0 || ny >= ctx.lv.H || nx < 0 || nx >= ctx.lv.W) continue;
      const n = cell(ny, nx, ctx.lv.W);
      if (cells.has(n) || !ctx.walkable.has(n) || boxSet.has(n)) continue;
      cells.add(n);
      if (n < min) min = n;
      q.push(n);
    }
  }
  return { cells, min };
}

interface RState {
  boxes: number[];   // sorted
  player: number;    // actual cell after the last push
  pushes: number;
  parent: number;    // index into the states array, -1 for the start
  action: string;    // walk + push that led here from the parent
  onGoal: number;    // boxes already sitting on goals (heap tie-break)
}

interface RoomResult { moves: string; endPlayer: number; pushes: number; }

// Push-based search. greedy=false is A* (f = pushes + h, optimal); greedy
// =true is best-first on h alone (finds a solved-but-maybe-suboptimal room
// when A* runs out of budget). Returns null when the budget runs out.
function searchRoom(ctx: RoomCtx, startBoxes: number[], startPlayer: number, needExit: boolean, budget: number, greedy: boolean): RoomResult | null {
  const { lv, room } = ctx;
  const goalKey = [...room.goals].sort((a, b) => a - b).join(',');
  const states: RState[] = [];
  const best = new Map<string, number>(); // state key -> fewest pushes seen
  const hCache = new Map<string, number>();
  const keyOf = (boxes: number[], canon: number): string => boxes.join(',') + '|' + canon;

  // Binary heap of state indices, ordered by (f, h, more boxes on goals,
  // insertion order). The boxes-on-goals tie-break steers the search toward
  // states that have actually banked progress, which cuts expansions on
  // rooms where the assignment heuristic alone ties many states.
  const heap: number[] = [];
  const heapF: number[] = [];
  const heapH: number[] = [];
  const heapG: number[] = [];
  const heapSeq: number[] = [];
  let seq = 0;
  const swap = (a: number, b: number): void => {
    let t = heap[a]; heap[a] = heap[b]; heap[b] = t;
    t = heapF[a]; heapF[a] = heapF[b]; heapF[b] = t;
    t = heapH[a]; heapH[a] = heapH[b]; heapH[b] = t;
    t = heapG[a]; heapG[a] = heapG[b]; heapG[b] = t;
    t = heapSeq[a]; heapSeq[a] = heapSeq[b]; heapSeq[b] = t;
  };
  const less = (a: number, b: number): boolean =>
    heapF[a] < heapF[b] ||
    (heapF[a] === heapF[b] && (heapH[a] < heapH[b] ||
    (heapH[a] === heapH[b] && (heapG[a] > heapG[b] ||
    (heapG[a] === heapG[b] && heapSeq[a] < heapSeq[b])))));
  const heapPush = (idx: number, f: number, h: number, onGoal: number): void => {
    heap.push(idx); heapF.push(f); heapH.push(h); heapG.push(onGoal); heapSeq.push(seq++);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(p, i);
      i = p;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.length - 1;
    heap[0] = heap[last]; heapF[0] = heapF[last]; heapH[0] = heapH[last]; heapG[0] = heapG[last]; heapSeq[0] = heapSeq[last];
    heap.pop(); heapF.pop(); heapH.pop(); heapG.pop(); heapSeq.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && less(l, m)) m = l;
      if (r < heap.length && less(r, m)) m = r;
      if (m === i) break;
      swap(m, i);
      i = m;
    }
    return top;
  };

  const startKey = [...startBoxes].sort((a, b) => a - b);
  const startRegion = region(ctx, startPlayer, new Set(startBoxes));
  const h0 = heuristic(ctx, startKey);
  if (h0 === Infinity) return null;
  const onGoalOf = (boxes: number[]): number => {
    let n = 0;
    for (const b of boxes) if (ctx.goalSet.has(b)) n++;
    return n;
  };
  states.push({ boxes: startKey, player: startPlayer, pushes: 0, parent: -1, action: '', onGoal: onGoalOf(startKey) });
  best.set(keyOf(startKey, startRegion.min), 0);
  heapPush(0, h0, h0, states[0].onGoal);

  let expansions = 0;
  while (heap.length > 0) {
    const si = heapPop();
    const st = states[si];
    const boxSet = new Set(st.boxes);
    const reg = region(ctx, st.player, boxSet);
    const k = keyOf(st.boxes, reg.min);
    if ((best.get(k) ?? Infinity) < st.pushes) continue; // stale heap entry
    if (st.boxes.join(',') === goalKey) {
      if (!needExit || reg.cells.has(room.door)) {
        // Reconstruct the move string.
        let moves = '';
        let cur = si;
        const parts: string[] = [];
        while (cur !== -1) {
          if (states[cur].action) parts.push(states[cur].action);
          cur = states[cur].parent;
        }
        parts.reverse();
        moves = parts.join('');
        let endPlayer = st.player;
        if (needExit && endPlayer !== room.door) {
          const exit = bfsPath(lv, endPlayer, room.door, (c) => reg.cells.has(c));
          if (exit === null) continue; // cannot actually exit; keep searching
          moves += exit;
          endPlayer = room.door;
        }
        return { moves, endPlayer, pushes: st.pushes };
      }
    }
    if (++expansions > budget) return null;
    // Generate pushes.
    for (let bi = 0; bi < st.boxes.length; bi++) {
      const b = st.boxes[bi];
      const by = Math.floor(b / lv.W);
      const bx = b % lv.W;
      for (let di = 0; di < 4; di++) {
        const d = DIRS[di];
        const dy = by + d.dy;
        const dx = bx + d.dx;
        if (dy < 0 || dy >= lv.H || dx < 0 || dx >= lv.W) continue;
        const dest = cell(dy, dx, lv.W);
        if (!room.floor.has(dest) || boxSet.has(dest)) continue;
        const py = by - d.dy;
        const px = bx - d.dx;
        if (py < 0 || py >= lv.H || px < 0 || px >= lv.W) continue;
        const behind = cell(py, px, lv.W);
        if (!reg.cells.has(behind)) continue;
        // Walk from the actual player cell to behind, then push.
        const walk = bfsPath(lv, st.player, behind, (c) => reg.cells.has(c));
        if (walk === null) continue;
        const nb = [...st.boxes];
        nb[bi] = dest;
        nb.sort((a, b) => a - b);
        if (nb.some((x) => ctx.dead[x])) continue;
        const nbKey = nb.join(',');
        let h = hCache.get(nbKey);
        if (h === undefined) { h = heuristic(ctx, nb); hCache.set(nbKey, h); }
        if (h === Infinity) continue;
        const nReg = region(ctx, b, new Set(nb));
        const nk = keyOf(nb, nReg.min);
        const np = st.pushes + 1;
        if ((best.get(nk) ?? Infinity) <= np) continue;
        best.set(nk, np);
        const nOnGoal = onGoalOf(nb);
        states.push({ boxes: nb, player: b, pushes: np, parent: si, action: walk + d.ch, onGoal: nOnGoal });
        heapPush(states.length - 1, greedy ? h : np + h, h, nOnGoal);
      }
    }
  }
  return null;
}

// ---------------- level solver ----------------

function solveLevel(text: string): string {
  const lv = parseLevel(text);
  const hw = findHallway(lv);
  const rooms = findRooms(lv, hw.cells, hw.horizontal);
  if (rooms.length === 0) return '';
  const boxSet = new Set(lv.boxes);
  let player = lv.player;
  let moves = '';
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri];
    const isLast = ri === rooms.length - 1;
    // Walk the hallway to this room's door.
    const walk = bfsPath(lv, player, room.entry, (c) => !boxSet.has(c));
    if (walk === null) return '';
    moves += walk;
    player = room.entry;
    // Solve the room from its door.
    const ctx = makeRoomCtx(lv, room);
    const roomBoxes = room.boxes.slice().sort((a, b) => a - b);
    let res = searchRoom(ctx, roomBoxes, room.entry, !isLast, ROOM_BUDGET, false);
    if (res === null) {
      res = searchRoom(ctx, roomBoxes, room.entry, !isLast, GREEDY_BUDGET, true);
    }
    if (res === null) return ''; // unsolved room: the level scores 0
    moves += res.moves;
    player = res.endPlayer;
    // Place this room's boxes on their goals for the remaining walks.
    for (const b of roomBoxes) boxSet.delete(b);
    for (const g of room.goals) boxSet.add(g);
  }
  return moves;
}

for (const id of readdirSync(IN).sort()) {
  const moves = solveLevel(readFileSync(join(IN, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'solution.txt'), `${moves}\n`);
}
