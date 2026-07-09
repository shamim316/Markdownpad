/* global api */
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const previewWrap = document.getElementById('preview-wrap');
const divider = document.getElementById('divider');
const saveStatusEl = document.getElementById('save-status');
const filePathEl = document.getElementById('file-path');
const cursorPosEl = document.getElementById('cursor-pos');
const countsEl = document.getElementById('counts');

// ---------- rendering ----------

let renderTimer = null;

function renderPreview() {
  preview.innerHTML = api.renderMarkdown(editor.value);
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderPreview();
  }, 120);
}

// ---------- status bar ----------

function updateCounts() {
  const text = editor.value;
  const words = (text.match(/\S+/g) || []).length;
  countsEl.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} character${text.length === 1 ? '' : 's'}`;
}

function updateCursorPos() {
  const upToCursor = editor.value.slice(0, editor.selectionStart);
  const line = (upToCursor.match(/\n/g) || []).length + 1;
  const col = upToCursor.length - upToCursor.lastIndexOf('\n');
  cursorPosEl.textContent = `Ln ${line}, Col ${col}`;
}

function setSaveStatus(status) {
  const labels = { saving: 'Saving…', saved: 'Saved', error: 'Save failed!', ready: 'Ready' };
  saveStatusEl.textContent = labels[status] || status;
  saveStatusEl.className = status;
}

// ---------- editing ----------

function onEdit() {
  scheduleRender();
  updateCounts();
  updateCursorPos();
  api.contentChanged(editor.value);
}

editor.addEventListener('input', onEdit);
editor.addEventListener('keyup', updateCursorPos);
editor.addEventListener('click', updateCursorPos);

// Insert markdown around the current selection, or as a line prefix.
function wrapSelection(before, after, placeholder) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const selected = value.slice(s, e) || placeholder;
  editor.setRangeText(before + selected + after, s, e, 'select');
  // put the caret around the inserted text sensibly
  editor.selectionStart = s + before.length;
  editor.selectionEnd = s + before.length + selected.length;
  editor.focus();
  onEdit();
}

function prefixLines(prefix, numbered = false) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const prefixed = lines.map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l).join('\n');
  editor.setRangeText(prefixed, lineStart, lineEnd, 'select');
  editor.focus();
  onEdit();
}

function insertBlock(text) {
  const { selectionStart: s, value } = editor;
  const needsNewline = s > 0 && value[s - 1] !== '\n';
  editor.setRangeText((needsNewline ? '\n' : '') + text, s, editor.selectionEnd, 'end');
  editor.focus();
  onEdit();
}

const actions = {
  bold: () => wrapSelection('**', '**', 'bold text'),
  italic: () => wrapSelection('*', '*', 'italic text'),
  strike: () => wrapSelection('~~', '~~', 'strikethrough'),
  h1: () => prefixLines('# '),
  h2: () => prefixLines('## '),
  h3: () => prefixLines('### '),
  link: () => wrapSelection('[', '](https://)', 'link text'),
  image: () => wrapSelection('![', '](image-url)', 'alt text'),
  code: () => wrapSelection('`', '`', 'code'),
  codeblock: () => insertBlock('```\ncode here\n```\n'),
  quote: () => prefixLines('> '),
  ul: () => prefixLines('- '),
  ol: () => prefixLines('', true),
  task: () => prefixLines('- [ ] '),
  hr: () => insertBlock('\n---\n'),
  table: () => insertBlock(
    '| Column 1 | Column 2 | Column 3 |\n' +
    '| -------- | -------- | -------- |\n' +
    '| Cell     | Cell     | Cell     |\n'
  )
};

document.getElementById('toolbar').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) actions[btn.dataset.action]();
});

// keyboard shortcuts
editor.addEventListener('keydown', e => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    const map = { b: 'bold', i: 'italic', k: 'link', 1: 'h1', 2: 'h2', 3: 'h3' };
    if (map[key]) {
      e.preventDefault();
      actions[map[key]]();
    }
  }
  // Tab inserts two spaces instead of leaving the editor
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    onEdit();
  }
});

// ---------- synced scrolling ----------

let syncSource = null;
let syncResetTimer = null;

function syncScroll(from, to) {
  if (syncSource && syncSource !== from) return;
  syncSource = from;
  clearTimeout(syncResetTimer);
  syncResetTimer = setTimeout(() => { syncSource = null; }, 120);
  const fromMax = from.scrollHeight - from.clientHeight;
  const toMax = to.scrollHeight - to.clientHeight;
  if (fromMax <= 0 || toMax <= 0) return;
  to.scrollTop = (from.scrollTop / fromMax) * toMax;
}

editor.addEventListener('scroll', () => syncScroll(editor, previewWrap));
previewWrap.addEventListener('scroll', () => syncScroll(previewWrap, editor));

// ---------- draggable divider ----------

divider.addEventListener('pointerdown', e => {
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  const main = document.getElementById('main');

  const onMove = ev => {
    const rect = main.getBoundingClientRect();
    let pct = ((ev.clientX - rect.left) / rect.width) * 100;
    pct = Math.max(15, Math.min(85, pct));
    editor.style.flexBasis = pct + '%';
  };
  const onUp = ev => {
    divider.classList.remove('dragging');
    divider.releasePointerCapture(ev.pointerId);
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', onUp);
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', onUp);
});

// ---------- drag & drop ----------

let dragDepth = 0;

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragenter', e => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragover');
});
document.addEventListener('dragleave', e => {
  e.preventDefault();
  if (--dragDepth === 0) document.body.classList.remove('dragover');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const filePath = api.pathForFile(file);
  if (filePath) api.openPath(filePath);
});

// ---------- export ----------

function buildExportDocument() {
  const title = filePathEl.textContent
    ? filePathEl.textContent.split(/[\\/]/).pop()
    : 'Untitled';
  const body = api.renderMarkdown(editor.value);
  const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter(l => l.href.includes('node_modules'))
    .map(l => l.sheet)
    .filter(Boolean);
  let css = '';
  for (const sheet of cssLinks) {
    try {
      css += [...sheet.cssRules].map(r => r.cssText).join('\n') + '\n';
    } catch { /* inaccessible sheet */ }
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
${css}
body { margin: 0; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 32px; }
</style>
</head>
<body>
<article class="markdown-body">
${body}
</article>
</body>
</html>`;
}

// ---------- app events from main ----------

api.onMenu(action => {
  if (action === 'save') api.save(editor.value);
  else if (action === 'save-as') api.saveAs(editor.value);
  else if (action === 'export-html') api.exportHtml(buildExportDocument());
  else if (action === 'export-pdf') api.exportPdf(buildExportDocument());
});

api.onFileOpened(({ filePath, content }) => {
  editor.value = content;
  filePathEl.textContent = filePath || '';
  filePathEl.title = filePath || '';
  renderPreview();
  updateCounts();
  updateCursorPos();
  setSaveStatus(filePath ? 'saved' : 'ready');
  editor.focus();
});

api.onFileState(({ filePath }) => {
  filePathEl.textContent = filePath || '';
  filePathEl.title = filePath || '';
});

api.onSaveStatus(setSaveStatus);

// ---------- init ----------

(async () => {
  const { content, filePath } = await api.getInit();
  editor.value = content;
  filePathEl.textContent = filePath || '';
  filePathEl.title = filePath || '';
  renderPreview();
  updateCounts();
  updateCursorPos();
  editor.focus();
})();
