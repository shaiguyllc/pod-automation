/* ── POD Automation Dashboard — Client ──────────────────────────────────── */

const socket = io();

// ── State ────────────────────────────────────────────────────────────────────
/** @type {Map<string, object>} keyed by "folder:filename" */
const images = new Map();
let automationRunning = false;
let renderScheduled = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const connectionDot    = document.getElementById('connection-dot');
const btnStart         = document.getElementById('btn-start');
const btnStop          = document.getElementById('btn-stop');
const automationStatus = document.getElementById('automation-status');
const dropZone         = document.getElementById('drop-zone');
const fileInput        = document.getElementById('file-input');
const contextMenu      = document.getElementById('context-menu');
const ctxFilename      = document.getElementById('ctx-filename');

const FOLDERS = ['inbox','needs-editing','needs-listing','ready-to-upload','uploading','complete','failed'];

// ── Socket events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  connectionDot.className = 'dot dot--connected';
  connectionDot.title = 'Connected';
});

socket.on('disconnect', () => {
  connectionDot.className = 'dot dot--disconnected';
  connectionDot.title = 'Disconnected';
});

socket.on('init.images', (allImages) => {
  images.clear();
  for (const img of allImages) {
    images.set(img.id, img);
  }
  scheduleRender();
});

socket.on('image:added', (img) => {
  images.set(img.id, img);
  scheduleRender();
});

socket.on('image:updated', (img) => {
  const existing = images.get(img.id);
  if (existing) {
    images.set(img.id, { ...existing, ...img });
  } else {
    images.set(img.id, img);
  }
  scheduleRender();
});

socket.on('image:moved', ({ filename, from, to }) => {
  const oldId = `${from}:${filename}`;
  const newId = `${to}:${filename}`;
  const existing = images.get(oldId);
  if (existing) {
    images.delete(oldId);
    images.set(newId, { ...existing, id: newId, folder: to });
  }
  scheduleRender();
});

socket.on('image:removed', ({ filename, from }) => {
  const id = `${from}:${filename}`;
  images.delete(id);
  scheduleRender();
});

socket.on('automation:started', () => setAutomationState(true));
socket.on('automation:stopped', () => setAutomationState(false));

socket.on('stage:toggled', ({ stage, enabled }) => {
  const checkbox = document.querySelector(`[data-stage="${stage}"]`);
  if (checkbox) checkbox.checked = enabled;
});

// ── Debounced rendering ───────────────────────────────────────────────────────
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  setTimeout(() => {
    renderScheduled = false;
    renderBoard();
  }, 260);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderBoard() {
  // Group images by folder
  const byFolder = {};
  for (const folder of FOLDERS) byFolder[folder] = [];
  for (const img of images.values()) {
    if (byFolder[img.folder]) byFolder[img.folder].push(img);
  }

  // Sort newest-first within each column
  for (const folder of FOLDERS) {
    byFolder[folder].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  // Render each column
  for (const folder of FOLDERS) {
    const cardsEl = document.getElementById(`cards-${folder}`);
    const countEl = document.getElementById(`count-${folder}`);
    if (!cardsEl) continue;

    const list = byFolder[folder];
    countEl.textContent = list.length;

    const CAP = 100;
    const visible = list.slice(0, CAP);

    if (visible.length === 0) {
      cardsEl.innerHTML = '<div class="empty-col">Empty</div>';
      continue;
    }

    const fragment = document.createDocumentFragment();
    for (const img of visible) {
      fragment.appendChild(buildCard(img));
    }

    if (list.length > CAP) {
      const more = document.createElement('div');
      more.className = 'empty-col';
      more.textContent = `+${list.length - CAP} more`;
      fragment.appendChild(more);
    }

    cardsEl.innerHTML = '';
    cardsEl.appendChild(fragment);
  }

  // Update header stats
  document.getElementById('stat-total').textContent    = images.size;
  document.getElementById('stat-ready').textContent    = byFolder['ready-to-upload'].length;
  document.getElementById('stat-complete').textContent = byFolder['complete'].length;
  document.getElementById('stat-failed').textContent   = byFolder['failed'].length;
}

function buildCard(img) {
  const card = document.createElement('div');
  card.className = 'card';
  if (img.folder === 'uploading') card.classList.add('card--uploading');
  if (img.folder === 'failed')    card.classList.add('card--failed');
  if (img.folder === 'complete')  card.classList.add('card--complete');

  card.dataset.filename = img.filename;
  card.dataset.folder   = img.folder;

  const name = document.createElement('div');
  name.className = 'card-name';
  name.title = img.filename;
  name.textContent = img.filename;

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  if (img.size) {
    const size = document.createElement('span');
    size.className = 'card-size';
    size.textContent = formatSize(img.size);
    meta.appendChild(size);
  }

  const jsonBadge = document.createElement('span');
  jsonBadge.className = `card-badge ${img.hasListingJson ? 'card-badge--json' : 'card-badge--no-json'}`;
  jsonBadge.textContent = img.hasListingJson ? 'listing' : 'no listing';
  meta.appendChild(jsonBadge);

  card.appendChild(name);
  card.appendChild(meta);

  if (img.listing?.title) {
    const label = document.createElement('div');
    label.className = 'card-label';
    label.title = img.listing.title;
    label.textContent = img.listing.title;
    card.appendChild(label);
  }

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, img);
  });

  return card;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Automation controls ───────────────────────────────────────────────────────
btnStart.addEventListener('click', () => {
  fetch('/automation/start', { method: 'POST' }).catch(console.error);
});

btnStop.addEventListener('click', () => {
  fetch('/automation/stop', { method: 'POST' }).catch(console.error);
});

function setAutomationState(running) {
  automationRunning = running;
  btnStart.disabled = running;
  btnStop.disabled  = !running;
  automationStatus.textContent = running ? 'Running' : 'Stopped';
  automationStatus.className   = running
    ? 'automation-status automation-status--running'
    : 'automation-status';
}

// ── Stage toggles ─────────────────────────────────────────────────────────────
document.querySelectorAll('[data-stage]').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    const stage = checkbox.dataset.stage;
    fetch(`/api/stage/${stage}/toggle`, { method: 'POST' }).catch(console.error);
  });
});

// Load current toggle state on startup
fetch('/api/settings')
  .then(r => r.json())
  .then(settings => {
    if (!settings.stageToggles) return;
    for (const [stage, enabled] of Object.entries(settings.stageToggles)) {
      const checkbox = document.querySelector(`[data-stage="${stage}"]`);
      if (checkbox) checkbox.checked = enabled;
    }
  })
  .catch(console.error);

// ── Context Menu ──────────────────────────────────────────────────────────────
let ctxTarget = null;

function showContextMenu(e, img) {
  ctxTarget = img;
  ctxFilename.textContent = img.filename;

  // Position
  const menu = contextMenu;
  menu.classList.remove('hidden');
  const { innerWidth: W, innerHeight: H } = window;
  let x = e.clientX, y = e.clientY;
  if (x + menu.offsetWidth > W)  x = W - menu.offsetWidth - 8;
  if (y + menu.offsetHeight > H) y = H - menu.offsetHeight - 8;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  ctxTarget = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

function moveImage(toFolder) {
  if (!ctxTarget) return;
  fetch('/api/image/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename:   ctxTarget.filename,
      fromFolder: ctxTarget.folder,
      toFolder,
    }),
  }).catch(console.error);
  hideContextMenu();
}

function removeImage() {
  if (!ctxTarget) return;
  fetch('/api/image/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename:   ctxTarget.filename,
      fromFolder: ctxTarget.folder,
    }),
  }).catch(console.error);
  hideContextMenu();
}

document.getElementById('ctx-move-inbox').addEventListener('click', () => moveImage('inbox'));
document.getElementById('ctx-move-editing').addEventListener('click', () => moveImage('needs-editing'));
document.getElementById('ctx-move-listing').addEventListener('click', () => moveImage('needs-listing'));
document.getElementById('ctx-move-ready').addEventListener('click', () => moveImage('ready-to-upload'));
document.getElementById('ctx-retry').addEventListener('click', () => moveImage('inbox'));
document.getElementById('ctx-remove').addEventListener('click', removeImage);

// ── File drop / upload ─────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  uploadFiles(fileInput.files);
  fileInput.value = '';
});

// Also allow dropping anywhere on the board
document.querySelector('.board').addEventListener('dragover', e => e.preventDefault());
document.querySelector('.board').addEventListener('drop', (e) => {
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});

function uploadFiles(fileList) {
  for (const file of fileList) {
    if (!/\.(png|jpg|jpeg)$/i.test(file.name)) continue;
    const fd = new FormData();
    fd.append('design', file);
    fetch('/api/upload', { method: 'POST', body: fd }).catch(console.error);
  }
}

// ── Initial render ────────────────────────────────────────────────────────────
renderBoard();
