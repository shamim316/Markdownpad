const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

let win = null;
let currentFile = null;      // absolute path of the open file, or null for Untitled
let autosaveTimer = null;
let pendingContent = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const draftPath = () => path.join(app.getPath('userData'), 'draft.md');

let settings = { recentFiles: [], theme: 'system' };

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    // first run or corrupt settings — defaults are fine
  }
  nativeTheme.themeSource = settings.theme;
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function addRecentFile(filePath) {
  settings.recentFiles = [filePath, ...settings.recentFiles.filter(f => f !== filePath)].slice(0, 10);
  saveSettings();
  buildMenu();
}

function windowTitle() {
  return `${currentFile ? path.basename(currentFile) : 'Untitled'} — MarkdownPad`;
}

function sendFileState() {
  if (!win) return;
  win.setTitle(windowTitle());
  win.webContents.send('file-state', { filePath: currentFile });
}

// ---------- auto-save ----------

function scheduleAutosave(content) {
  pendingContent = content;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  win?.webContents.send('save-status', 'saving');
  autosaveTimer = setTimeout(flushAutosave, 500);
}

async function flushAutosave() {
  autosaveTimer = null;
  if (pendingContent === null) return;
  const content = pendingContent;
  pendingContent = null;
  const target = currentFile || draftPath();
  try {
    await fsp.writeFile(target, content, 'utf8');
    win?.webContents.send('save-status', 'saved');
  } catch (err) {
    win?.webContents.send('save-status', 'error');
    console.error('Autosave failed:', err);
  }
}

// ---------- file operations ----------

async function openFile(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    await flushAutosave();
    currentFile = filePath;
    addRecentFile(filePath);
    sendFileState();
    win.webContents.send('file-opened', { filePath, content });
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
    settings.recentFiles = settings.recentFiles.filter(f => f !== filePath);
    saveSettings();
    buildMenu();
  }
}

async function openFileDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!canceled && filePaths[0]) await openFile(filePaths[0]);
}

async function saveAs(content) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: currentFile || 'Untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (canceled || !filePath) return null;
  await fsp.writeFile(filePath, content, 'utf8');
  const wasUntitled = !currentFile;
  currentFile = filePath;
  if (wasUntitled) {
    fsp.unlink(draftPath()).catch(() => {});
  }
  addRecentFile(filePath);
  sendFileState();
  win.webContents.send('save-status', 'saved');
  return filePath;
}

async function newFile() {
  await flushAutosave();
  currentFile = null;
  fsp.unlink(draftPath()).catch(() => {});
  sendFileState();
  win.webContents.send('file-opened', { filePath: null, content: '' });
}

// ---------- export ----------

async function exportHtml(htmlDocument) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: (currentFile ? path.basename(currentFile, path.extname(currentFile)) : 'Untitled') + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (canceled || !filePath) return;
  await fsp.writeFile(filePath, htmlDocument, 'utf8');
  shell.showItemInFolder(filePath);
}

async function exportPdf(htmlDocument) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: (currentFile ? path.basename(currentFile, path.extname(currentFile)) : 'Untitled') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return;

  const tmpFile = path.join(app.getPath('temp'), `markdownpad-export-${Date.now()}.html`);
  await fsp.writeFile(tmpFile, htmlDocument, 'utf8');
  const pdfWin = new BrowserWindow({ show: false });
  try {
    await pdfWin.loadFile(tmpFile);
    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    });
    await fsp.writeFile(filePath, data);
    shell.showItemInFolder(filePath);
  } finally {
    pdfWin.destroy();
    fsp.unlink(tmpFile).catch(() => {});
  }
}

// ---------- menu ----------

function buildMenu() {
  const recentItems = settings.recentFiles.length
    ? settings.recentFiles.map(f => ({
        label: f,
        click: () => openFile(f)
      }))
    : [{ label: '(empty)', enabled: false }];

  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => newFile() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFileDialog() },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu', 'save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.webContents.send('menu', 'save-as') },
        { type: 'separator' },
        { label: 'Export as HTML…', click: () => win.webContents.send('menu', 'export-html') },
        { label: 'Export as PDF…', click: () => win.webContents.send('menu', 'export-pdf') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Theme',
          submenu: ['system', 'light', 'dark'].map(t => ({
            label: t[0].toUpperCase() + t.slice(1),
            type: 'radio',
            checked: settings.theme === t,
            click: () => {
              settings.theme = t;
              nativeTheme.themeSource = t;
              saveSettings();
            }
          }))
        },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Markdown Guide',
          click: () => shell.openExternal('https://www.markdownguide.org/basic-syntax/')
        },
        {
          label: 'About MarkdownPad',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'About MarkdownPad',
            message: 'MarkdownPad',
            detail: `Version ${app.getVersion()}\nA Notepad-style Markdown editor with live preview and auto-save.`
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- window ----------

function fileFromArgv(argv) {
  return argv.slice(1).find(a => !a.startsWith('-') && /\.(md|markdown|mdown|txt)$/i.test(a)) || null;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  win.setTitle(windowTitle());
  win.on('closed', () => { win = null; });
  await win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

// ---------- IPC ----------

ipcMain.handle('get-init', async () => {
  let content = '';
  const argFile = fileFromArgv(process.argv);
  if (argFile && fs.existsSync(argFile)) {
    currentFile = path.resolve(argFile);
    content = await fsp.readFile(currentFile, 'utf8');
    addRecentFile(currentFile);
  } else {
    try { content = await fsp.readFile(draftPath(), 'utf8'); } catch {}
  }
  sendFileState();
  return { content, filePath: currentFile, theme: settings.theme };
});

ipcMain.on('content-changed', (_e, content) => scheduleAutosave(content));

ipcMain.handle('save', async (_e, content) => {
  if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; pendingContent = null; }
  if (currentFile) {
    await fsp.writeFile(currentFile, content, 'utf8');
    win.webContents.send('save-status', 'saved');
    return currentFile;
  }
  return saveAs(content);
});

ipcMain.handle('save-as', (_e, content) => saveAs(content));
ipcMain.handle('open-path', (_e, filePath) => openFile(filePath));
ipcMain.handle('export-html', (_e, html) => exportHtml(html));
ipcMain.handle('export-pdf', (_e, html) => exportPdf(html));

// ---------- lifecycle ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileFromArgv(argv);
    if (f && fs.existsSync(f)) openFile(path.resolve(f));
  });

  app.whenReady().then(() => {
    loadSettings();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      if (pendingContent !== null) {
        try { fs.writeFileSync(currentFile || draftPath(), pendingContent, 'utf8'); } catch {}
      }
    }
  });
}
