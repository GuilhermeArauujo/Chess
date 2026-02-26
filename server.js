const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function initialBoard() {
  return [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
  ];
}

function initialState() {
  return {
    board: initialBoard(),
    turn: 'w',
    castling: { K: true, Q: true, k: true, q: true },
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
  };
}

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function colorOf(piece) { if (!piece) return null; return piece === piece.toUpperCase() ? 'w' : 'b'; }
function enemy(color) { return color === 'w' ? 'b' : 'w'; }

function toSquare(r, c) { return `${'abcdefgh'[c]}${8 - r}`; }
function fromSquare(square) {
  if (!/^[a-h][1-8]$/.test(square || '')) return null;
  return { r: 8 - Number(square[1]), c: square.charCodeAt(0) - 97 };
}

function findKing(state, color) {
  const target = color === 'w' ? 'K' : 'k';
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if (state.board[r][c] === target) return { r, c };
  return null;
}

function isSquareAttacked(state, r, c, byColor) {
  const board = state.board;

  const pawnDir = byColor === 'w' ? -1 : 1;
  for (const dc of [-1, 1]) {
    const pr = r - pawnDir;
    const pc = c + dc;
    if (inBounds(pr, pc)) {
      const p = board[pr][pc];
      if (p && colorOf(p) === byColor && p.toLowerCase() === 'p') return true;
    }
  }

  const knightSteps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (const [dr, dc] of knightSteps) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const p = board[nr][nc];
    if (p && colorOf(p) === byColor && p.toLowerCase() === 'n') return true;
  }

  const lines = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dr, dc] of lines) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && ['r', 'q'].includes(p.toLowerCase())) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  const diags = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [dr, dc] of diags) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === byColor && ['b', 'q'].includes(p.toLowerCase())) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }

  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const p = board[nr][nc];
    if (p && colorOf(p) === byColor && p.toLowerCase() === 'k') return true;
  }

  return false;
}

function inCheck(state, color) {
  const k = findKing(state, color);
  if (!k) return false;
  return isSquareAttacked(state, k.r, k.c, enemy(color));
}

function pushMove(moves, from, to, extras = {}) {
  moves.push({ from: toSquare(from.r, from.c), to: toSquare(to.r, to.c), ...extras });
}

function pseudoMoves(state, color) {
  const moves = [];
  const board = state.board;

  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) {
    const piece = board[r][c];
    if (!piece || colorOf(piece) !== color) continue;
    const t = piece.toLowerCase();
    const from = { r, c };

    if (t === 'p') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const promoRow = color === 'w' ? 0 : 7;
      const one = { r: r + dir, c };
      if (inBounds(one.r, one.c) && !board[one.r][one.c]) {
        if (one.r === promoRow) ['q','r','b','n'].forEach((promotion) => pushMove(moves, from, one, { promotion }));
        else pushMove(moves, from, one);

        const two = { r: r + (2 * dir), c };
        if (r === startRow && !board[two.r][two.c]) pushMove(moves, from, two, { doublePush: true });
      }

      for (const dc of [-1, 1]) {
        const cap = { r: r + dir, c: c + dc };
        if (!inBounds(cap.r, cap.c)) continue;
        const target = board[cap.r][cap.c];
        if (target && colorOf(target) === enemy(color)) {
          if (cap.r === promoRow) ['q','r','b','n'].forEach((promotion) => pushMove(moves, from, cap, { promotion }));
          else pushMove(moves, from, cap);
        }
      }

      if (state.enPassant) {
        const ep = fromSquare(state.enPassant);
        if (ep && ep.r === r + dir && Math.abs(ep.c - c) === 1) pushMove(moves, from, ep, { enPassant: true });
      }
    }

    if (t === 'n') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (!board[nr][nc] || colorOf(board[nr][nc]) === enemy(color)) pushMove(moves, from, { r: nr, c: nc });
      }
    }

    if (['b','r','q'].includes(t)) {
      const dirs = [];
      if (['b','q'].includes(t)) dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
      if (['r','q'].includes(t)) dirs.push([1,0],[-1,0],[0,1],[0,-1]);
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          if (!board[nr][nc]) pushMove(moves, from, { r: nr, c: nc });
          else {
            if (colorOf(board[nr][nc]) === enemy(color)) pushMove(moves, from, { r: nr, c: nc });
            break;
          }
          nr += dr; nc += dc;
        }
      }
    }

    if (t === 'k') {
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        if (!board[nr][nc] || colorOf(board[nr][nc]) === enemy(color)) pushMove(moves, from, { r: nr, c: nc });
      }

      if (color === 'w' && r === 7 && c === 4) {
        if (state.castling.K && !board[7][5] && !board[7][6]) pushMove(moves, from, { r: 7, c: 6 }, { castle: 'K' });
        if (state.castling.Q && !board[7][3] && !board[7][2] && !board[7][1]) pushMove(moves, from, { r: 7, c: 2 }, { castle: 'Q' });
      }
      if (color === 'b' && r === 0 && c === 4) {
        if (state.castling.k && !board[0][5] && !board[0][6]) pushMove(moves, from, { r: 0, c: 6 }, { castle: 'k' });
        if (state.castling.q && !board[0][3] && !board[0][2] && !board[0][1]) pushMove(moves, from, { r: 0, c: 2 }, { castle: 'q' });
      }
    }
  }
  return moves;
}

function applyMove(state, move) {
  const from = fromSquare(move.from);
  const to = fromSquare(move.to);
  if (!from || !to) return null;

  const next = {
    ...state,
    board: cloneBoard(state.board),
    castling: { ...state.castling },
    enPassant: null,
  };

  const piece = next.board[from.r][from.c];
  if (!piece) return null;
  const color = colorOf(piece);
  const target = next.board[to.r][to.c];

  next.board[from.r][from.c] = null;

  if (move.enPassant && piece.toLowerCase() === 'p') {
    const capRow = color === 'w' ? to.r + 1 : to.r - 1;
    next.board[capRow][to.c] = null;
  }

  let placed = piece;
  if (move.promotion && piece.toLowerCase() === 'p') placed = color === 'w' ? move.promotion.toUpperCase() : move.promotion.toLowerCase();
  next.board[to.r][to.c] = placed;

  if (move.castle) {
    if (move.castle === 'K') { next.board[7][7] = null; next.board[7][5] = 'R'; }
    if (move.castle === 'Q') { next.board[7][0] = null; next.board[7][3] = 'R'; }
    if (move.castle === 'k') { next.board[0][7] = null; next.board[0][5] = 'r'; }
    if (move.castle === 'q') { next.board[0][0] = null; next.board[0][3] = 'r'; }
  }

  if (piece === 'K') { next.castling.K = false; next.castling.Q = false; }
  if (piece === 'k') { next.castling.k = false; next.castling.q = false; }
  if (piece === 'R' && from.r === 7 && from.c === 0) next.castling.Q = false;
  if (piece === 'R' && from.r === 7 && from.c === 7) next.castling.K = false;
  if (piece === 'r' && from.r === 0 && from.c === 0) next.castling.q = false;
  if (piece === 'r' && from.r === 0 && from.c === 7) next.castling.k = false;
  if (target === 'R' && to.r === 7 && to.c === 0) next.castling.Q = false;
  if (target === 'R' && to.r === 7 && to.c === 7) next.castling.K = false;
  if (target === 'r' && to.r === 0 && to.c === 0) next.castling.q = false;
  if (target === 'r' && to.r === 0 && to.c === 7) next.castling.k = false;

  if (piece.toLowerCase() === 'p' && Math.abs(to.r - from.r) === 2) {
    const epRow = color === 'w' ? to.r + 1 : to.r - 1;
    next.enPassant = toSquare(epRow, to.c);
  }

  next.halfmove = (piece.toLowerCase() === 'p' || target) ? 0 : state.halfmove + 1;
  next.fullmove = color === 'b' ? state.fullmove + 1 : state.fullmove;
  next.turn = enemy(state.turn);
  return next;
}

function legalMoves(state, color = state.turn) {
  const moves = pseudoMoves(state, color);
  return moves.filter((move) => {
    if (move.castle) {
      const k = findKing(state, color);
      if (!k || isSquareAttacked(state, k.r, k.c, enemy(color))) return false;
      const path = move.castle.toLowerCase() === 'q' ? [3, 2] : [5, 6];
      const row = color === 'w' ? 7 : 0;
      for (const col of path) if (isSquareAttacked(state, row, col, enemy(color))) return false;
    }
    const next = applyMove(state, move);
    return next && !inCheck(next, color);
  });
}

function gameStatus(state) {
  const moves = legalMoves(state);
  const check = inCheck(state, state.turn);
  return {
    check,
    checkmate: check && moves.length === 0,
    stalemate: !check && moves.length === 0,
    draw: !check && moves.length === 0,
    legalMoves: moves,
  };
}

function boardFen(board) {
  return board.map((row) => {
    let out = '';
    let empty = 0;
    row.forEach((cell) => {
      if (!cell) empty += 1;
      else {
        if (empty) out += String(empty);
        empty = 0;
        out += cell;
      }
    });
    if (empty) out += String(empty);
    return out;
  }).join('/');
}

const games = new Map();

function ensureRoom(roomId) {
  if (!games.has(roomId)) {
    games.set(roomId, { state: initialState(), players: { white: null, black: null } });
  }
  return games.get(roomId);
}

function payload(game, token) {
  const role = token && game.players.white === token ? 'white' : token && game.players.black === token ? 'black' : 'spectator';
  const status = gameStatus(game.state);
  return {
    role,
    turn: game.state.turn,
    fen: `${boardFen(game.state.board)} ${game.state.turn}`,
    check: status.check,
    checkmate: status.checkmate,
    stalemate: status.stalemate,
    draw: status.draw,
    gameOver: status.checkmate || status.stalemate,
    legalMoves: status.legalMoves,
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

function serveStatic(req, res) {
  const target = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, target);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/join') {
    const { roomId } = await readBody(req);
    const room = String(roomId || '').trim().toLowerCase();
    if (!room) return json(res, 400, { error: 'roomId required' });

    const game = ensureRoom(room);
    const token = crypto.randomBytes(16).toString('hex');
    if (!game.players.white) game.players.white = token;
    else if (!game.players.black) game.players.black = token;
    return json(res, 200, { token, ...payload(game, token) });
  }

  if (req.method === 'GET' && req.url.startsWith('/api/state')) {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const room = String(u.searchParams.get('room') || '').trim().toLowerCase();
    const token = String(u.searchParams.get('token') || '');
    if (!room || !games.has(room)) return json(res, 404, { error: 'room not found' });
    return json(res, 200, payload(games.get(room), token));
  }

  if (req.method === 'POST' && req.url === '/api/move') {
    const { roomId, token, from, to, promotion } = await readBody(req);
    const room = String(roomId || '').trim().toLowerCase();
    if (!room || !games.has(room)) return json(res, 404, { error: 'room not found' });
    const game = games.get(room);
    const role = game.players.white === token ? 'white' : game.players.black === token ? 'black' : 'spectator';
    const color = role === 'white' ? 'w' : role === 'black' ? 'b' : null;
    if (!color || color !== game.state.turn) return json(res, 403, { error: 'not your turn' });

    const legal = legalMoves(game.state).find((m) => m.from === from && m.to === to && ((!m.promotion && !promotion) || m.promotion === promotion || (!m.promotion && promotion === undefined)));
    if (!legal) return json(res, 400, { error: 'illegal move' });
    const chosen = { ...legal, promotion: legal.promotion || promotion };
    game.state = applyMove(game.state, chosen);
    return json(res, 200, payload(game, token));
  }

  if (req.method === 'POST' && req.url === '/api/reset') {
    const { roomId, token } = await readBody(req);
    const room = String(roomId || '').trim().toLowerCase();
    if (!room || !games.has(room)) return json(res, 404, { error: 'room not found' });
    const game = games.get(room);
    const isPlayer = game.players.white === token || game.players.black === token;
    if (!isPlayer) return json(res, 403, { error: 'only players can reset' });
    game.state = initialState();
    return json(res, 200, payload(game, token));
  }

  return serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN Chess running at http://0.0.0.0:${PORT}`);
});
