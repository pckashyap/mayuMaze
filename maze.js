const canvas = document.getElementById('maze-canvas');
const ctx = canvas.getContext('2d');

const levelDisplay = document.getElementById('level-display');
const timerDisplay = document.getElementById('timer-display');
const movesDisplay = document.getElementById('moves-display');
const messageEl = document.getElementById('message');

// walls: 0=top, 1=right, 2=bottom, 3=left
// DIRS entries: [dr, dc, myWallIdx, neighborWallIdx]
const DIRS = [[-1,0,0,2],[0,1,1,3],[1,0,2,0],[0,-1,3,1]];
const W = 640, H = 360;
const FOV = Math.PI / 2.2;

// ── Maze generation ──────────────────────────────────────────────────────────

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateMaze(rows, cols) {
  const grid = Array.from({length: rows}, () =>
    Array.from({length: cols}, () => ({walls: [true,true,true,true], visited: false}))
  );
  function carve(r, c) {
    grid[r][c].visited = true;
    for (const [dr, dc, w1, w2] of shuffle([...DIRS])) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !grid[nr][nc].visited) {
        grid[r][c].walls[w1] = false;
        grid[nr][nc].walls[w2] = false;
        carve(nr, nc);
      }
    }
  }
  carve(0, 0);
  return {grid, rows, cols};
}

function findPath(maze, sr, sc, er, ec) {
  const {grid, rows, cols} = maze;
  const vis = Array.from({length: rows}, () => new Array(cols).fill(false));
  const queue = [[sr, sc, [{r:sr,c:sc}]]];
  vis[sr][sc] = true;
  while (queue.length) {
    const [r, c, path] = queue.shift();
    if (r === er && c === ec) return path;
    for (const [dr, dc, wi] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !vis[nr][nc] && !grid[r][c].walls[wi]) {
        vis[nr][nc] = true;
        queue.push([nr, nc, [...path, {r:nr,c:nc}]]);
      }
    }
  }
  return [];
}

// ── Raycasting ───────────────────────────────────────────────────────────────

// DDA ray cast. Returns perpendicular wall distance and which cell was hit.
function castRay(maze, px, py, angle) {
  const {grid, rows, cols} = maze;
  const rdx = Math.cos(angle), rdy = Math.sin(angle);
  let mapX = Math.floor(px), mapY = Math.floor(py);
  const ddx = rdx === 0 ? Infinity : Math.abs(1 / rdx);
  const ddy = rdy === 0 ? Infinity : Math.abs(1 / rdy);
  const sx = rdx < 0 ? -1 : 1, sy = rdy < 0 ? -1 : 1;
  let sdx = rdx < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
  let sdy = rdy < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;

  for (let i = 0; i < rows + cols + 4; i++) {
    if (mapX < 0 || mapX >= cols || mapY < 0 || mapY >= rows) break;
    if (sdx < sdy) {
      if (grid[mapY][mapX].walls[sx > 0 ? 1 : 3]) return {dist: sdx, side: 0, mapX, mapY};
      sdx += ddx; mapX += sx;
    } else {
      if (grid[mapY][mapX].walls[sy > 0 ? 2 : 0]) return {dist: sdy, side: 1, mapX, mapY};
      sdy += ddy; mapY += sy;
    }
  }
  return {dist: Infinity, side: 0, mapX, mapY};
}

// Returns true if (x,y) is too close to a wall to stand at.
function wouldCollide(maze, x, y) {
  const {grid, rows, cols} = maze;
  const m = 0.22;
  const col = Math.floor(x), row = Math.floor(y);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
  const {walls} = grid[row][col];
  const fx = x - col, fy = y - row;
  return (fy < m && walls[0]) || (fy > 1 - m && walls[2]) ||
         (fx < m && walls[3]) || (fx > 1 - m && walls[1]);
}

// ── Sky image ────────────────────────────────────────────────────────────────

const skyImg = new Image();
skyImg.src = 'Sky.jpg.webp';

function renderFloor() {
  ctx.fillStyle = state.level >= 3 ? '#1a0000' : '#ffffff';
  ctx.fillRect(0, Math.floor(H / 2), W, H - Math.floor(H / 2));
}

function renderSky() {
  if (!skyImg.complete || !skyImg.naturalWidth) {
    // Fallback until image loads
    const g = ctx.createLinearGradient(0, 0, 0, H / 2);
    g.addColorStop(0, '#060818'); g.addColorStop(1, '#0f1030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H / 2);
    return;
  }
  const {player} = state;
  const iw = skyImg.naturalWidth, ih = skyImg.naturalHeight;
  // Width of sky to show for current FOV
  const srcW = (FOV / (Math.PI * 2)) * iw;
  // Left edge of visible strip, centred on player angle (with wrap)
  const offset = ((player.angle / (Math.PI * 2)) * iw - srcW / 2 + iw * 10) % iw;
  const dh = Math.ceil(H / 2) + 2;

  if (offset + srcW <= iw) {
    ctx.drawImage(skyImg, offset, 0, srcW, ih, 0, 0, W, dh);
  } else {
    // Panorama wraps around: draw in two pieces
    const firstSrcW = iw - offset;
    const firstDstW = (firstSrcW / srcW) * W;
    ctx.drawImage(skyImg, offset, 0, firstSrcW, ih, 0,          0, firstDstW,     dh);
    ctx.drawImage(skyImg, 0,      0, srcW - firstSrcW, ih, firstDstW, 0, W - firstDstW, dh);
  }

  // Darken the horizon edge so it blends into the wall zone
  const fade = ctx.createLinearGradient(0, dh * 0.55, 0, dh);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, dh);

  // Scary mode: blood-red tint over the sky
  if (state.level >= 3) {
    ctx.fillStyle = 'rgba(120,0,0,0.55)';
    ctx.fillRect(0, 0, W, dh);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const {maze, player, hintPath} = state;
  const {rows, cols} = maze;
  const maxDist = Math.hypot(rows, cols);

  // Torch flicker — scary mode is more erratic and dimmer
  const scary = state.level >= 3;
  const t = Date.now();
  const flicker = scary
    ? 1 + Math.sin(t * 0.018) * 0.18 + Math.sin(t * 0.041) * 0.10
    : 1 + Math.sin(t * 0.007) * 0.05 + Math.sin(t * 0.017) * 0.03;
  const torchRadius = (scary ? 3.2 : 5.5) * flicker;

  // Sky panorama
  renderSky();

  // Textured floor
  renderFloor();

  // Wall columns
  for (let x = 0; x < W; x++) {
    const rayAngle = player.angle - FOV / 2 + (x / W) * FOV;
    const {dist, side, mapX, mapY} = castRay(maze, player.x, player.y, rayAngle);
    if (dist === Infinity) continue;

    const wallH = Math.min(H * 4, H / dist);
    const top = Math.floor((H - wallH) / 2);
    const bot = Math.floor((H + wallH) / 2);

    const isExit = mapX === cols - 1 && mapY === rows - 1;

    // Torch: quadratic falloff, blends warm orange close → cool blue far
    const torchStr = Math.max(0, 1 - (dist / torchRadius) ** 2);
    const fade = Math.max(0.04, 1 - dist / maxDist);
    const sideDim = side === 1 ? 0.62 : 1.0;

    let wr, wg, wb;
    if (isExit) {
      wr = 50  * fade * 1.3 * sideDim;
      wg = 215 * fade * 1.1 * sideDim;
      wb = 205 * fade * 1.1 * sideDim;
    } else if (scary) {
      // Dark blood-red stone + red-orange torch
      const ar = 55, ag = 5,  ab = 5;   // cold ambient: deep red
      const tr = 255, tg = 30, tb = 10; // torch: red fire
      const blend = torchStr * 0.88;
      wr = (ar * (1 - blend) + tr * blend) * fade * sideDim;
      wg = (ag * (1 - blend) + tg * blend) * fade * sideDim;
      wb = (ab * (1 - blend) + tb * blend) * fade * sideDim;
    } else {
      // Ambient cold stone + torch warm overlay
      const ar = 35, ag = 40,  ab = 115; // cold ambient
      const tr = 255, tg = 155, tb = 55; // warm torch
      const blend = torchStr * 0.82;
      wr = (ar * (1 - blend) + tr * blend) * fade * sideDim;
      wg = (ag * (1 - blend) + tg * blend) * fade * sideDim;
      wb = (ab * (1 - blend) + tb * blend) * fade * sideDim;
    }

    ctx.fillStyle = `rgb(${Math.floor(wr)},${Math.floor(wg)},${Math.floor(wb)})`;
    ctx.fillRect(x, top, 1, bot - top);
  }

  // Torch glow — orange normally, red in scary mode
  const glowR = scary ? '200,20,10' : '255,140,40';
  const glowR2 = scary ? '160,10,5'  : '255,90,20';
  const glow = ctx.createRadialGradient(W / 2, H * 0.56, 0, W / 2, H * 0.56, H * 0.62);
  glow.addColorStop(0,    `rgba(${glowR},${0.10 * flicker})`);
  glow.addColorStop(0.45, `rgba(${glowR2},${0.04 * flicker})`);
  glow.addColorStop(1,    'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Vignette — black normally, deep red in scary mode
  const vigEdge = scary ? 'rgba(80,0,0,0.82)' : 'rgba(0,0,0,0.6)';
  const vig = ctx.createRadialGradient(W/2, H/2, H * 0.22, W/2, H/2, H * 0.82);
  vig.addColorStop(0, 'transparent');
  vig.addColorStop(1, vigEdge);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W/2 - 9, H/2); ctx.lineTo(W/2 + 9, H/2);
  ctx.moveTo(W/2, H/2 - 9); ctx.lineTo(W/2, H/2 + 9);
  ctx.stroke();

  renderMinimap(hintPath);
}

function renderMinimap(hintPath) {
  const {maze, player} = state;
  const {grid, rows, cols} = maze;
  const cs = Math.max(4, Math.floor(72 / Math.max(rows, cols)));
  const mw = cols * cs, mh = rows * cs;
  const mx = W - mw - 10, my = 10;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,14,0.72)';
  ctx.fillRect(mx - 1, my - 1, mw + 2, mh + 2);

  // Exit
  ctx.fillStyle = 'rgba(78,205,196,0.55)';
  ctx.fillRect(mx + (cols-1)*cs, my + (rows-1)*cs, cs, cs);

  // Hint path
  if (hintPath) {
    ctx.fillStyle = 'rgba(255,210,60,0.45)';
    for (const {r,c} of hintPath) ctx.fillRect(mx + c*cs + 1, my + r*cs + 1, cs - 2, cs - 2);
  }

  // Walls (batched)
  ctx.strokeStyle = 'rgba(160,165,240,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const {walls} = grid[r][c];
      const x = mx + c*cs, y = my + r*cs;
      if (walls[0]) { ctx.moveTo(x, y);    ctx.lineTo(x+cs, y); }
      if (walls[1]) { ctx.moveTo(x+cs, y); ctx.lineTo(x+cs, y+cs); }
      if (walls[2]) { ctx.moveTo(x, y+cs); ctx.lineTo(x+cs, y+cs); }
      if (walls[3]) { ctx.moveTo(x, y);    ctx.lineTo(x, y+cs); }
    }
  }
  ctx.stroke();

  // Player dot + direction arrow
  const px = mx + player.x * cs, py = my + player.y * cs;
  ctx.fillStyle = '#ff6b6b';
  ctx.beginPath();
  ctx.arc(px, py, cs * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(player.angle) * cs * 1.3, py + Math.sin(player.angle) * cs * 1.3);
  ctx.stroke();

  ctx.restore();
}

// ── Game state & loop ────────────────────────────────────────────────────────

const keys = {};
const virt = {}; // virtual keys from touch

let state = {};
let rafId = null;

function initLevel(lvl) {
  clearInterval(state.timerInterval);
  clearTimeout(state.hintTimeout);
  cancelAnimationFrame(rafId);

  const size = 7 + (lvl - 1) * 2;
  const maze = generateMaze(size, size);

  canvas.width = W;
  canvas.height = H;

  state = {
    maze,
    player: {x: 0.5, y: 0.5, angle: Math.PI / 4},
    level: lvl,
    moves: 0,
    elapsed: 0,
    hintPath: null,
    won: false,
    lastCell: {r: 0, c: 0},
    timerInterval: setInterval(() => {
      state.elapsed++;
      timerDisplay.textContent = state.elapsed + 's';
    }, 1000),
  };

  levelDisplay.textContent = lvl;
  movesDisplay.textContent = '0';
  timerDisplay.textContent = '0s';
  messageEl.classList.add('hidden');
  messageEl.innerHTML = '';

  rafId = requestAnimationFrame(loop);
}

function update() {
  if (state.won) return;
  const {player, maze} = state;
  const spd = 0.04, turn = 0.045;

  if (keys['ArrowLeft']  || keys['a'] || keys['A'] || virt.left)  player.angle -= turn;
  if (keys['ArrowRight'] || keys['d'] || keys['D'] || virt.right) player.angle += turn;

  const fwd = (keys['ArrowUp']   || keys['w'] || keys['W'] || virt.fwd)  ?  spd : 0;
  const bwd = (keys['ArrowDown'] || keys['s'] || keys['S'] || virt.back) ? -spd : 0;
  const move = fwd + bwd;

  if (move !== 0) {
    const nx = player.x + Math.cos(player.angle) * move;
    const ny = player.y + Math.sin(player.angle) * move;
    if (!wouldCollide(maze, nx, player.y)) player.x = nx;
    if (!wouldCollide(maze, player.x, ny)) player.y = ny;
  }

  // Move counter (cell crossings)
  const cr = Math.floor(player.y), cc = Math.floor(player.x);
  if (cr !== state.lastCell.r || cc !== state.lastCell.c) {
    state.lastCell = {r: cr, c: cc};
    state.moves++;
    state.hintPath = null;
    movesDisplay.textContent = state.moves;

    if (cc === maze.cols - 1 && cr === maze.rows - 1) levelComplete();
  }
}

function loop() {
  update();
  render();
  if (!state.won) rafId = requestAnimationFrame(loop);
}

function levelComplete() {
  state.won = true;
  clearInterval(state.timerInterval);
  render();

  if (state.level === 2) {
    messageEl.innerHTML = `
      <h2>Looks like you need a challenge</h2>
      <button id="next-btn">Enter Level 3 →</button>
    `;
  } else {
    messageEl.innerHTML = `
      <h2>Level ${state.level} Complete!</h2>
      <p>${state.elapsed}s &nbsp;·&nbsp; ${state.moves} moves</p>
      <button id="next-btn">Next Level →</button>
    `;
  }
  messageEl.classList.remove('hidden');
  document.getElementById('next-btn').addEventListener('click', () => initLevel(state.level + 1));
}

function showHint() {
  if (state.won) return;
  const {maze, player} = state;
  state.hintPath = findPath(maze, Math.floor(player.y), Math.floor(player.x), maze.rows-1, maze.cols-1);
  clearTimeout(state.hintTimeout);
  state.hintTimeout = setTimeout(() => { state.hintPath = null; }, 5000);
}

// ── Input ────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch joystick: left half = turn, right half = move forward/back
const touchStarts = {};
canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) touchStarts[t.identifier] = {x: t.clientX, y: t.clientY};
  e.preventDefault();
}, {passive: false});

canvas.addEventListener('touchmove', e => {
  const rect = canvas.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  Object.assign(virt, {left:false, right:false, fwd:false, back:false});

  for (const t of e.changedTouches) {
    const start = touchStarts[t.identifier];
    if (!start) continue;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (start.x < midX) {
      if (dx > 12) virt.right = true;
      else if (dx < -12) virt.left = true;
    } else {
      if (dy < -12) virt.fwd = true;
      else if (dy > 12) virt.back = true;
    }
  }
  e.preventDefault();
}, {passive: false});

canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) delete touchStarts[t.identifier];
  if (Object.keys(touchStarts).length === 0) Object.assign(virt, {left:false, right:false, fwd:false, back:false});
  e.preventDefault();
}, {passive: false});

document.getElementById('new-game-btn').addEventListener('click', () => initLevel(1));
document.getElementById('solve-btn').addEventListener('click', showHint);

initLevel(1);
