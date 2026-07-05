const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { Marked } = require('marked');
const createDOMPurify = require('dompurify');
const hljs = require('highlight.js');

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').split(/\s+/)[0];
      let highlighted;
      try {
        highlighted = language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
      } catch {
        highlighted = null;
      }
      if (highlighted === null) {
        const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre><code>${esc}</code></pre>\n`;
      }
      const cls = 'hljs' + (language ? ` language-${language}` : '');
      return `<pre><code class="${cls}">${highlighted}</code></pre>\n`;
    }
  }
});

let purify = null;

contextBridge.exposeInMainWorld('api', {
  renderMarkdown: text => {
    const raw = marked.parse(text);
    if (!purify) purify = createDOMPurify(window);
    return purify.sanitize(raw, { ADD_ATTR: ['align'] });
  },
  getInit: () => ipcRenderer.invoke('get-init'),
  contentChanged: content => ipcRenderer.send('content-changed', content),
  save: content => ipcRenderer.invoke('save', content),
  saveAs: content => ipcRenderer.invoke('save-as', content),
  openPath: filePath => ipcRenderer.invoke('open-path', filePath),
  exportHtml: html => ipcRenderer.invoke('export-html', html),
  exportPdf: html => ipcRenderer.invoke('export-pdf', html),
  pathForFile: file => webUtils.getPathForFile(file),
  onMenu: cb => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onFileOpened: cb => ipcRenderer.on('file-opened', (_e, data) => cb(data)),
  onFileState: cb => ipcRenderer.on('file-state', (_e, data) => cb(data)),
  onSaveStatus: cb => ipcRenderer.on('save-status', (_e, status) => cb(status))
});
