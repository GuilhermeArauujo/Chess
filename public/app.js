const boardEl = document.getElementById('board');
const roleEl = document.getElementById('role');
const turnEl = document.getElementById('turn');
const stateEl = document.getElementById('state');
const joinForm = document.getElementById('join-form');
const resetBtn = document.getElementById('reset');

const glyph = { p:'♟', r:'♜', n:'♞', b:'♝', q:'♛', k:'♚', P:'♙', R:'♖', N:'♘', B:'♗', Q:'♕', K:'♔' };

let roomId = null;
let token = null;
let state = null;
let selected = null;
let pollTimer = null;

function myColor() {
  return state?.role === 'white' ? 'w' : state?.role === 'black' ? 'b' : null;
}

function parseBoard(fen) {
  const b = [];
  for (const row of fen.split(' ')[0].split('/')) {
    const out = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i += 1) out.push(null);
      else out.push(ch);
    }
    b.push(out);
  }
  return b;
}

function sq(r, c) { return `${'abcdefgh'[c]}${8-r}`; }

function pieceAt(square) {
  const b = parseBoard(state.fen);
  const c = square.charCodeAt(0) - 97;
  const r = 8 - Number(square[1]);
  const p = b[r][c];
  return p ? { piece: p, color: p === p.toUpperCase() ? 'w' : 'b' } : null;
}

function legalFrom(square) {
  return (state?.legalMoves || []).filter((m) => m.from === square);
}

function describeStatus() {
  if (!state) return 'Waiting...';
  if (state.checkmate) return `Checkmate. ${state.turn === 'w' ? 'Black' : 'White'} wins.`;
  if (state.stalemate) return 'Stalemate.';
  if (state.draw) return 'Draw.';
  if (state.check) return 'Check!';
  return 'In progress';
}

function render() {
  boardEl.innerHTML = '';
  if (!state) return;
  roleEl.textContent = state.role;
  turnEl.textContent = state.turn === 'w' ? 'White' : 'Black';
  stateEl.textContent = describeStatus();

  const b = parseBoard(state.fen);
  const rows = state.turn === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  const cols = state.turn === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
  const targets = legalFrom(selected).map((m) => m.to);

  for (const r of rows) for (const c of cols) {
    const square = document.createElement('button');
    const pos = sq(r,c);
    square.type = 'button';
    square.className = `square ${(r+c)%2===0?'light':'dark'}`;
    if (selected === pos) square.classList.add('selected');
    if (targets.includes(pos)) square.classList.add('target');
    if (b[r][c]) square.textContent = glyph[b[r][c]];
    square.onclick = () => clickSquare(pos);
    boardEl.appendChild(square);
  }
}

async function refresh() {
  if (!roomId || !token) return;
  const res = await fetch(`/api/state?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`);
  if (!res.ok) return;
  state = await res.json();
  if (!legalFrom(selected).length) selected = null;
  render();
}

async function join(room) {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId: room }),
  });
  if (!res.ok) return;
  const data = await res.json();
  roomId = room;
  token = data.token;
  state = data;
  selected = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 800);
  render();
}

async function clickSquare(square) {
  if (!state || state.gameOver) return;
  if (myColor() !== state.turn) return;

  if (!selected) {
    const p = pieceAt(square);
    if (!p || p.color !== myColor()) return;
    selected = square;
    render();
    return;
  }

  if (selected === square) {
    selected = null;
    render();
    return;
  }

  const move = legalFrom(selected).find((m) => m.to === square);
  if (!move) {
    const p = pieceAt(square);
    if (p && p.color === myColor()) selected = square;
    render();
    return;
  }

  let promotion;
  if (move.promotion) {
    promotion = (prompt('Promote to q/r/b/n', 'q') || 'q').toLowerCase();
    if (!['q', 'r', 'b', 'n'].includes(promotion)) promotion = 'q';
  }

  const res = await fetch('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, token, from: selected, to: square, promotion }),
  });
  if (res.ok) state = await res.json();
  selected = null;
  render();
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  join(String(new FormData(joinForm).get('room') || '').trim());
});

resetBtn.addEventListener('click', async () => {
  if (!roomId || !token) return;
  const res = await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, token }),
  });
  if (res.ok) state = await res.json();
  selected = null;
  render();
});
