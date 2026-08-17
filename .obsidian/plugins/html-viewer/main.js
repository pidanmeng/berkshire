'use strict';

var obsidian = require('obsidian');

const VIEW_TYPE_HTML = 'html-view';
const HTML_EXTENSIONS = ['html', 'htm'];

// ============================================================
// HTML View — renders HTML files in a sandboxed iframe
// ============================================================
class HtmlView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.sourceMode = false;
    this.scriptsEnabled = true;
    this.content = '';
    this._renderVersion = 0;   // incremented per render; guards async races
    this._blobUrl = null;
  }

  getViewType() {
    return VIEW_TYPE_HTML;
  }

  getDisplayText() {
    return (this.file && this.file.name) ? this.file.name : 'HTML Viewer';
  }

  getIcon() {
    return 'file-code';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('html-viewer-root');

    // --- toolbar ---
    const toolbar = container.createEl('div', { cls: 'html-viewer-toolbar' });

    const sourceBtn = toolbar.createEl('button', {
      text: 'Source',
      cls: 'html-viewer-source-btn'
    });
    sourceBtn.addEventListener('click', () => this.toggleSourceMode());

    toolbar.createEl('span', { text: ' | ' });

    const scriptBtn = toolbar.createEl('button', {
      text: 'Scripts: ON',
      cls: 'html-viewer-script-btn'
    });
    scriptBtn.addEventListener('click', () => this.toggleScripts());
    scriptBtn.addClass('active');

    toolbar.createEl('span', { text: ' | ' });

    const refreshBtn = toolbar.createEl('button', {
      text: 'Refresh',
      cls: 'html-viewer-refresh-btn'
    });
    refreshBtn.addEventListener('click', () => this.refresh());

    // --- content area ---
    this.contentEl = container.createEl('div', { cls: 'html-viewer-content' });

    if (this.file) {
      await this.renderFile(this.file);
    }
  }

  async onClose() {
    this.content = '';
    this.file = null;
    this._revokeBlobUrl();
  }

  // ---- state persistence (tab switches) ----
  getState() {
    return { file: this.file ? this.file.path : null };
  }

  async setState(state, _result) {
    if (!state || !state.file) return;

    // DEDUP: if this file is already open in another leaf, close
    // this newly-created one and focus the existing tab.
    const allLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HTML);
    for (const leaf of allLeaves) {
      const v = leaf.view;
      if (v instanceof HtmlView && v !== this && v.file
        && v.file.path === state.file) {
        this.app.workspace.revealLeaf(leaf);
        this.leaf.detach();
        return;
      }
    }

    const file = this.app.vault.getAbstractFileByPath(state.file);
    if (file instanceof obsidian.TFile) {
      this.file = file;
      await this.renderFile(file);
    }
  }

  // ---- called by openLinkText ----
  async setFile(file) {
    this.file = file;
    await this.renderFile(file);
  }

  // ---- toggle source / rendered ----
  toggleSourceMode() {
    this.sourceMode = !this.sourceMode;
    const btn = this.containerEl.querySelector('.html-viewer-source-btn');
    if (btn) {
      if (this.sourceMode) {
        btn.addClass('active');
        btn.setText('Rendered');
      } else {
        btn.removeClass('active');
        btn.setText('Source');
      }
    }
    if (this.file) this.renderFile(this.file);
  }

  // ---- toggle scripts ----
  toggleScripts() {
    this.scriptsEnabled = !this.scriptsEnabled;
    const btn = this.containerEl.querySelector('.html-viewer-script-btn');
    if (btn) {
      if (this.scriptsEnabled) {
        btn.addClass('active');
        btn.setText('Scripts: ON');
      } else {
        btn.removeClass('active');
        btn.setText('Scripts: OFF');
      }
    }
    if (this.file) this.renderFile(this.file);
  }

  // ---- manual refresh ----
  async refresh() {
    if (this.file) await this.renderFile(this.file);
  }

  // ================================================================
  //  Render pipeline
  // ================================================================
  async renderFile(file) {
    if (!file || !this.contentEl) return;

    // Bump version so any in-flight async work is discarded
    const version = ++this._renderVersion;

    let raw;
    try {
      raw = await this.app.vault.read(file);
    } catch (err) {
      if (version !== this._renderVersion) return;
      this.contentEl.empty();
      this.contentEl.createEl('div', {
        cls: 'html-viewer-empty',
        text: 'Error reading file: ' + err.message
      });
      return;
    }

    // Guard: another render started while we were reading
    if (version !== this._renderVersion) return;

    this.content = raw;
    this.contentEl.empty();

    if (this.sourceMode) {
      this._renderSource();
    } else {
      this._renderRendered();
    }
  }

  // ---- source view ----
  _renderSource() {
    const ta = this.contentEl.createEl('textarea', {
      cls: 'html-viewer-source',
      attr: { readonly: true, spellcheck: false }
    });
    ta.value = this.content;
  }

  // ---- rendered view (sandboxed iframe) ----
  _renderRendered() {
    let html = this.content;

    if (this.scriptsEnabled) {
      // Scripts allowed — strip inline event handlers and
      // javascript: pseudo-URLs, then inject auto-focus helper.
      html = html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/href\s*=\s*["']javascript:[^"']*["']/gi,
          'href="#"');
      html += '<script>'
        + 'window.addEventListener("load",function(){'
        + 'document.body.focus();'
        + 'document.body.setAttribute("tabindex","0");'
        + 'document.body.style.outline="none";'
        + '});'
        + '<\/script>';
    } else {
      // Scripts blocked — strip <script> tags, event handlers,
      // and javascript: links.
      html = html.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        '<!-- script removed -->'
      );
      html = html.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/href\s*=\s*["']javascript:[^"']*["']/gi,
          'href="#"');
    }

    // Revoke previous blob
    this._revokeBlobUrl();

    const sandboxAttr = this.scriptsEnabled
      ? 'allow-scripts allow-same-origin'
      : 'allow-same-origin';

    const blob = new Blob([html], { type: 'text/html' });
    this._blobUrl = URL.createObjectURL(blob);

    const iframe = this.contentEl.createEl('iframe', {
      cls: 'html-viewer-iframe',
      attr: {
        sandbox: sandboxAttr,
        title: this.file ? this.file.name : 'HTML View',
        src: this._blobUrl
      }
    });

    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';

    // Auto-focus for keyboard games
    if (this.scriptsEnabled) {
      iframe.addEventListener('load', () => {
        try {
          iframe.focus();
          if (iframe.contentWindow) iframe.contentWindow.focus();
        } catch (_) { /* harmless */ }
      }, { once: true });
    }
  }

  // ---- helpers ----
  _revokeBlobUrl() {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }
}

// ============================================================
// Plugin
// ============================================================
class HtmlViewerPlugin extends obsidian.Plugin {
  async onload() {
    console.log('HTML Viewer: loaded');

    this.registerView(VIEW_TYPE_HTML, (leaf) => new HtmlView(leaf, this));

    this.addCommand({
      id: 'open-html-viewer',
      name: 'Open HTML viewer',
      callback: () => this._openActiveHtmlFile()
    });

    this.registerExtensions(HTML_EXTENSIONS, VIEW_TYPE_HTML);

    // ── Auto-refresh when the HTML file is modified externally ──
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof obsidian.TFile)) return;
        if (!this._isHtmlFile(file)) return;
        // Find any views showing this file and refresh them
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HTML);
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof HtmlView && view.file
            && view.file.path === file.path) {
            view.renderFile(file);
          }
        }
      })
    );

    // ── Clean up blob URLs when file is deleted ──
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (!(file instanceof obsidian.TFile)) return;
        if (!this._isHtmlFile(file)) return;
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HTML);
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof HtmlView && view.file
            && view.file.path === file.path) {
            view.contentEl.empty();
            view.contentEl.createEl('div', {
              cls: 'html-viewer-empty',
              text: 'File deleted: ' + file.name
            });
            view.file = null;
          }
        }
      })
    );
  }

  onunload() {
    console.log('HTML Viewer: unloaded');
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_HTML);
  }

  // ---- helpers ----
  _isHtmlFile(file) {
    if (!file || !(file instanceof obsidian.TFile)) return false;
    const ext = file.extension || '';
    return HTML_EXTENSIONS.includes(ext.toLowerCase());
  }

  async _openInHtmlView(file) {
    if (!file || !this._isHtmlFile(file)) return;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_HTML,
      state: { file: file.path },
      active: true
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async _openActiveHtmlFile() {
    const file = this.app.workspace.getActiveFile();
    if (file && this._isHtmlFile(file)) {
      await this._openInHtmlView(file);
    }
  }
}

module.exports = HtmlViewerPlugin;

/* nosourcemap */