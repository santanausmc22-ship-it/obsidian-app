/* ===================== Obsidian App — Core Navigation ===================== */

const VIEWS = ['home','blog-list','blog-article','wall','watch-grid','watch-player','listen','scripture-landing','scripture-books','scripture-chapters','scripture-reading','journal-list','journal-write'];

function showView(viewId, opts) {
  opts = opts || {};
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById('view-' + viewId);
  if (target) {
    target.classList.add('active');
    target.scrollTop = 0;
  }
  // update tab bar active state only for top-level views
  const topLevelMap = { 'home':'home', 'watch-grid':'watch', 'watch-player':'watch',
    'listen':'listen', 'wall':'wall', 'blog-list':'blog', 'blog-article':'blog' };
  const tabKey = topLevelMap[viewId];
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (tabKey) {
    const tabEl = document.querySelector('.tab[data-tab="' + tabKey + '"]');
    if (tabEl) tabEl.classList.add('active');
  }
  window.scrollTo(0,0);
}

// simple history stack so back buttons make sense
const navStack = ['home'];
function navTo(viewId, opts) {
  navStack.push(viewId);
  showView(viewId, opts);
  if (viewId === 'wall') initWallView();
  if (viewId === 'journal-list') renderJournalList();
}
function navBack() {
  if (navStack.length > 1) {
    navStack.pop();
    showView(navStack[navStack.length - 1]);
  } else {
    showView('home');
  }
}
function navReset(viewId) {
  navStack.length = 0;
  navStack.push(viewId);
  showView(viewId);
}

/* ===================== Journal — Private, On-Device Storage ===================== */
/* Uses Capacitor Preferences plugin when running in the real app.
   Falls back to localStorage when previewing in a plain browser. */

const JOURNAL_KEY = 'obsidian_journal_entries';

function getStorage() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
    return window.Capacitor.Plugins.Preferences;
  }
  return null;
}

async function loadJournalEntries() {
  const cap = getStorage();
  let raw;
  if (cap) {
    const result = await cap.get({ key: JOURNAL_KEY });
    raw = result.value;
  } else {
    raw = localStorage.getItem(JOURNAL_KEY);
  }
  return raw ? JSON.parse(raw) : [];
}

async function saveJournalEntries(entries) {
  const raw = JSON.stringify(entries);
  const cap = getStorage();
  if (cap) {
    await cap.set({ key: JOURNAL_KEY, value: raw });
  } else {
    localStorage.setItem(JOURNAL_KEY, raw);
  }
}

function formatEntryDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function renderJournalList() {
  const entries = await loadJournalEntries();
  const container = document.getElementById('journal-entries-list');
  if (!container) return;
  if (entries.length === 0) {
    container.innerHTML = '<div class="journal-empty">Nothing here yet. Tap "New Entry" to write your first one.</div>';
    return;
  }
  // newest first
  const sorted = entries.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  container.innerHTML = sorted.map(e => {
    const preview = e.text.length > 120 ? e.text.slice(0, 120) + '...' : e.text;
    return '<div class="entry-row" onclick="openJournalEntry(\'' + e.id + '\')">'
      + '<div class="date">' + formatEntryDate(e.createdAt) + '</div>'
      + '<div class="preview">' + escapeHtmlJournal(preview) + '</div>'
      + '</div>';
  }).join('');
}

function escapeHtmlJournal(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let currentEditingEntryId = null;

function openNewJournalEntry() {
  currentEditingEntryId = null;
  const textarea = document.getElementById('journal-textarea');
  if (textarea) textarea.value = '';
  const dateLabel = document.getElementById('journal-write-date');
  if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  navTo('journal-write');
  if (textarea) setTimeout(() => textarea.focus(), 300);
}

async function openJournalEntry(id) {
  const entries = await loadJournalEntries();
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  currentEditingEntryId = id;
  const textarea = document.getElementById('journal-textarea');
  if (textarea) textarea.value = entry.text;
  const dateLabel = document.getElementById('journal-write-date');
  if (dateLabel) dateLabel.textContent = formatEntryDate(entry.createdAt);
  navTo('journal-write');
}

async function saveJournalEntry() {
  const textarea = document.getElementById('journal-textarea');
  if (!textarea || !textarea.value.trim()) {
    navBack();
    return;
  }
  const entries = await loadJournalEntries();
  if (currentEditingEntryId) {
    const entry = entries.find(e => e.id === currentEditingEntryId);
    if (entry) entry.text = textarea.value;
  } else {
    entries.push({
      id: 'entry_' + Date.now(),
      text: textarea.value,
      createdAt: new Date().toISOString()
    });
  }
  await saveJournalEntries(entries);
  await renderJournalList();
  navBack();
}

function cancelJournalEntry() {
  navBack();
}

/* ===================== The Wall — Real, Live Data ===================== */
/* This is the exact same logic already running on the live obsidianmusic.org/wall page,
   connected to the same Neon database via the same Vercel API endpoints. */

const PAPER_STYLES = ['paper1 torn', 'lined', 'paper2 torn', 'paper3', 'paper4 torn2'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function shareIconHtml() {
  return '<div class="note-share" onclick="event.stopPropagation();shareNote(this)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg></div>';
}

function isRecent(createdAt) {
  if (!createdAt) return false;
  const posted = new Date(createdAt);
  const now = new Date();
  return posted.getFullYear() === now.getFullYear()
    && posted.getMonth() === now.getMonth()
    && posted.getDate() === now.getDate();
}

function buildNoteEl(message, styleIndex, createdAt) {
  const style = PAPER_STYLES[styleIndex % PAPER_STYLES.length];
  const el = document.createElement('div');
  el.className = 'note ' + style;
  el.setAttribute('data-msg', message);
  el.innerHTML = '<p>' + escapeHtml(message) + '</p>' + shareIconHtml();
  return el;
}

let wallMessageTotal = 0;
let needResponseTotal = 0;

function updateStatsDisplay() {
  const el = document.getElementById('wall-stats');
  if (!el) return;
  el.innerHTML = '<span><b>' + (wallMessageTotal + 13).toLocaleString() + '</b> words posted</span><span><b>' + needResponseTotal.toLocaleString() + '</b> words answered</span>';
}

async function loadWallMessages() {
  try {
    const res = await fetch('https://obsidianmusic.org/api/wall-messages');
    if (!res.ok) return;
    const data = await res.json();
    const rows = data.items || [];
    wallMessageTotal = data.total || rows.length;
    updateStatsDisplay();
    const grid = document.getElementById('wall-grid');
    // rows arrive newest-first; insert oldest-first so the newest ends up on top
    rows.slice().reverse().forEach((row, i) => {
      const el = buildNoteEl(row.message, i, row.created_at);
      grid.insertBefore(el, grid.firstChild);
    });
  } catch (e) {
    // fails silently -- curated notes still show either way
  }
}

function scrollToWall() {
  document.querySelector('.wall-section').scrollIntoView({ behavior: 'smooth' });
}

function toggleNeedForm() {
  const form = document.getElementById('need-form');
  form.style.display = form.style.display === 'block' ? 'none' : 'block';
  if (form.style.display === 'block') {
    document.getElementById('need-input').focus();
  }
}

function renderNeedCard(need) {
  const card = document.createElement('div');
  card.className = 'need-card';
  card.setAttribute('data-need-id', need.id);
  card.style.position = 'relative';

  const msg = document.createElement('p');
  msg.className = 'need-msg';
  msg.textContent = need.message;
  card.appendChild(msg);

  const meta = document.createElement('div');
  meta.className = 'need-meta';
  meta.textContent = 'A Father, Speaking Freely';
  card.appendChild(meta);

  const responsesWrap = document.createElement('div');
  responsesWrap.className = 'need-responses';
  if (need.responses && need.responses.length) {
    need.responses.forEach((r) => {
      const rEl = document.createElement('div');
      rEl.className = 'need-response';
      const rP = document.createElement('p');
      rP.textContent = r.message;
      rEl.appendChild(rP);
      responsesWrap.appendChild(rEl);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'need-empty';
    empty.textContent = 'No words yet. Be the first.';
    responsesWrap.appendChild(empty);
  }
  card.appendChild(responsesWrap);

  const row = document.createElement('div');
  row.className = 'respond-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 280;
  input.placeholder = 'Leave a word for them...';
  const btn = document.createElement('button');
  btn.textContent = 'Post';
  btn.onclick = () => submitResponse(need.id, input, card);
  row.appendChild(input);
  row.appendChild(btn);
  card.appendChild(row);

  return card;
}

async function loadNeeds() {
  const feed = document.getElementById('needs-feed');
  try {
    const res = await fetch('https://obsidianmusic.org/api/wall-needs');
    if (!res.ok) return;
    const data = await res.json();
    const needs = data.items || [];
    needResponseTotal = data.total_responses || 0;
    updateStatsDisplay();
    feed.innerHTML = '';
    if (needs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'needs-empty-state';
      empty.textContent = 'Nobody has posted yet. Be the first to speak freely.';
      feed.appendChild(empty);
      return;
    }
    needs.forEach((n) => feed.appendChild(renderNeedCard(n)));
  } catch (e) {
    // fails silently
  }
}

async function submitNeed() {
  const input = document.getElementById('need-input');
  const status = document.getElementById('need-status');
  const message = input.value.trim();

  if (window.needSubmitting) return;

  if (message.length < 3) {
    status.textContent = 'Write a little more first.';
    return;
  }

  window.needSubmitting = true;
  status.textContent = 'Posting...';
  try {
    const res = await fetch('https://obsidianmusic.org/api/wall-needs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Could not post. Try again.';
      window.needSubmitting = false;
      return;
    }
    const feed = document.getElementById('needs-feed');
    const emptyState = feed.querySelector('.needs-empty-state');
    if (emptyState) emptyState.remove();
    const card = renderNeedCard(data);
    card.style.opacity = '0';
    feed.insertBefore(card, feed.firstChild);
    requestAnimationFrame(() => {
      card.style.transition = 'opacity .4s ease';
      card.style.opacity = '1';
    });
    input.value = '';
    status.textContent = 'Posted.';
    document.getElementById('needs-board').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { document.getElementById('need-form').style.display = 'none'; status.textContent = ''; }, 1500);
  } catch (e) {
    status.textContent = 'Something went wrong. Try again.';
  }
  window.needSubmitting = false;
}

async function submitResponse(needId, input, card) {
  const message = input.value.trim();
  if (message.length < 2) return;

  try {
    const res = await fetch('https://obsidianmusic.org/api/wall-need-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ need_id: needId, message })
    });
    const data = await res.json();
    if (!res.ok) {
      input.placeholder = data.error || 'Could not post.';
      return;
    }
    const responsesWrap = card.querySelector('.need-responses');
    const empty = responsesWrap.querySelector('.need-empty');
    if (empty) empty.remove();
    const rEl = document.createElement('div');
    rEl.className = 'need-response';
    rEl.style.opacity = '0';
    const rP = document.createElement('p');
    rP.textContent = data.message;
    rEl.appendChild(rP);
    responsesWrap.appendChild(rEl);
    needResponseTotal += 1;
    updateStatsDisplay();
    requestAnimationFrame(() => {
      rEl.style.transition = 'opacity .4s ease';
      rEl.style.opacity = '1';
    });
    input.value = '';
    input.placeholder = 'Leave a word for them...';
  } catch (e) {
    input.placeholder = 'Something went wrong.';
  }
}


function toggleLeaveForm() {
  const form = document.getElementById('leave-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') document.getElementById('leave-input').focus();
}

async function submitWord() {
  const input = document.getElementById('leave-input');
  const status = document.getElementById('leave-status');
  const message = input.value.trim();

  if (window.wordSubmitting) return;

  if (message.length < 3) {
    status.textContent = 'Write a little more first.';
    return;
  }

  window.wordSubmitting = true;
  status.textContent = 'Posting...';
  try {
    const res = await fetch('https://obsidianmusic.org/api/wall-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Could not post. Try again.';
      window.wordSubmitting = false;
      return;
    }
    const grid = document.getElementById('wall-grid');
    const el = buildNoteEl(data.message, 0, data.created_at);
    el.style.opacity = '0';
    grid.insertBefore(el, grid.firstChild);
    wallMessageTotal += 1;
    updateStatsDisplay();
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '1';
    });
    input.value = '';
    status.textContent = 'Posted. Thank you.';
    setTimeout(() => { document.getElementById('leave-form').style.display = 'none'; status.textContent = ''; }, 1500);
  } catch (e) {
    status.textContent = 'Something went wrong. Try again.';
  }
  window.wordSubmitting = false;
}


function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawNoteCard(msg) {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#0d0b09';
  ctx.fillRect(0, 0, size, size);

  // soft ember radial glow, centered
  const glow = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, 520);
  glow.addColorStop(0, 'rgba(217,105,31,0.30)');
  glow.addColorStop(1, 'rgba(217,105,31,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.textAlign = 'center';

  // message text, wrapped, to know how tall the block is
  ctx.font = 'italic 54px Georgia, serif';
  const maxWidth = size * 0.66;
  const lines = wrapText(ctx, msg, maxWidth);
  const lineHeight = 74;

  // eyebrow + quote centered together as one group
  const eyebrowGap = 50;
  const blockH = lineHeight * lines.length;
  const totalH = 40 + eyebrowGap + blockH;
  const startY = size/2 - totalH/2;

  ctx.fillStyle = '#d9691f';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('\u2014  T H E   F A T H E R   W A L L  \u2014', size/2, startY);

  const msgStartY = startY + 40 + eyebrowGap;
  ctx.fillStyle = '#ece4d6';
  ctx.font = 'italic 54px Georgia, serif';
  lines.forEach((line, i) => {
    ctx.fillText(line, size/2, msgStartY + i*lineHeight);
  });

  // footer url
  ctx.fillStyle = '#9a9184';
  ctx.font = '500 17px "IBM Plex Mono", monospace';
  ctx.fillText('obsidianmusic.org/wall', size/2, size - 140);

  return canvas;
}

async function shareNote(btn) {
  const noteEl = btn.closest('.note');
  const msg = noteEl.getAttribute('data-msg');
  if (!msg) return;

  const original = btn.innerHTML;
  btn.style.opacity = '0.5';

  const canvas = drawNoteCard(msg);

  canvas.toBlob(async (blob) => {
    btn.style.opacity = '1';
    const file = new File([blob], 'father-wall.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'The Father Wall',
          text: msg
        });
        return;
      } catch (e) {
        // user cancelled or share failed, fall through to download
      }
    }

    // fallback: trigger a download so they can save it manually
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'father-wall.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

function initWallView() {
  loadWallMessages();
  loadNeeds();
}
