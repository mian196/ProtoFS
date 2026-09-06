import './style.css';
import { ProtoFsApi } from './api';
import { ThemeManager, PALETTES } from './theme';
import type { Palette } from './theme';
import type { DriveMetadata, FileNode, FolderNode } from './types';

class ProtoFsApp {
  private api = new ProtoFsApi();
  private themeManager = new ThemeManager();

  private activeDrive = 'personal';
  private currentFolderId = 'root';
  private activeFilter: string | null = null;

  private drives: DriveMetadata[] = [];
  private folders: FolderNode[] = [];
  private files: FileNode[] = [];

  constructor() {
    this.themeManager.init();
    this.renderAppShell();
    this.bindEvents();
    this.loadData();
  }

  private renderAppShell() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.innerHTML = `
      <!-- Top Title Bar -->
      <header class="proto-header">
        <div class="brand-box">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
          <span class="brand-name">ProtoFS</span>
          <span class="version-pill">v0.2.0</span>
        </div>

        <div class="search-container">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="search-input" id="globalSearchInput" placeholder="Search files, folders, encrypted vaults..." aria-label="Search">
          <span class="shortcut-hint">Ctrl+K</span>
        </div>

        <div class="header-actions">
          <button class="icon-btn" id="btnPalette" title="Color Themes" aria-label="Choose color palette">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          </button>
          <button class="icon-btn" id="btnTheme" title="Toggle Light/Dark Mode" aria-label="Toggle Light and Dark Mode">
            <svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>
          </button>
          <button class="icon-btn" id="btnSyncPairs" title="Sync Pairs" aria-label="Sync Pairs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          </button>
          <div class="user-avatar" id="btnAvatar" title="Telegram: @MuzAmMaL (Connected)">
            <span>MZ</span>
          </div>
        </div>
      </header>

      <!-- Main Workspace -->
      <div class="workspace-container">
        <!-- Sidebar -->
        <aside class="sidebar">
          <div>
            <div class="sidebar-section-title">
              <span>Drives</span>
              <button class="icon-btn" id="btnNewDrive" style="width:22px;height:22px;">+</button>
            </div>
            <nav class="nav-list" id="drivesNavList"></nav>

            <div class="sidebar-section-title" style="margin-top: 20px;">
              <span>Filters</span>
            </div>
            <nav class="nav-list">
              <button class="nav-item" data-filter="pinned">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                <span>Offline Pinned</span>
              </button>
              <button class="nav-item" data-filter="encrypted">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>Encrypted Vaults</span>
              </button>
              <button class="nav-item" data-filter="trash">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                <span>Trash</span>
              </button>
            </nav>
          </div>

          <!-- Storage Card -->
          <div class="storage-card" id="btnStorageCard">
            <div class="storage-card-header">
              <span>Cloud Storage</span>
              <span style="color: var(--accent-primary);">4.2 GB</span>
            </div>
            <div class="storage-bar">
              <div class="storage-bar-fill" style="width: 32%;"></div>
            </div>
            <div class="storage-sub">Telegram Channel: Unlimited Quota</div>
          </div>
        </aside>

        <!-- Main Explorer View -->
        <main class="main-view">
          <!-- Toolbar -->
          <div class="action-toolbar">
            <div class="breadcrumbs-bar" id="breadcrumbsBar"></div>
            <div class="toolbar-buttons">
              <button class="btn-action secondary" id="btnNewFolder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <span>New Folder</span>
              </button>
              <button class="btn-action primary" id="btnUpload">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>Upload</span>
              </button>
            </div>
          </div>

          <!-- Browser Viewport -->
          <div class="browser-viewport">
            <div id="foldersSection">
              <div class="section-label">Folders</div>
              <div class="folder-grid" id="foldersGrid"></div>
            </div>

            <div id="filesSection">
              <div class="section-label">Files</div>
              <div class="file-list" id="filesList"></div>
            </div>
          </div>

          <!-- Transfer Dock -->
          <div class="transfer-dock">
            <div class="transfer-status-text">
              <span class="transfer-dot"></span>
              <span>All files synced • MTProto DC4 Connected</span>
            </div>
            <span style="font-family: var(--font-mono); color: var(--text-muted);">ProtoFS FUSE Engine Active</span>
          </div>
        </main>
      </div>

      <!-- Modals Container -->
      <div id="modalsRoot"></div>
    `;
  }

  private async loadData() {
    this.drives = await this.api.getDrives();
    this.renderDrives();
    this.renderCurrentFolder();
  }

  private renderDrives() {
    const nav = document.getElementById('drivesNavList');
    if (!nav) return;

    nav.innerHTML = this.drives
      .map(
        (d) => `
        <button class="nav-item ${d.id === this.activeDrive ? 'active' : ''}" data-drive="${d.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>
          <span>${d.name}</span>
        </button>
      `
      )
      .join('');

    nav.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeDrive = btn.getAttribute('data-drive') || 'personal';
        this.currentFolderId = 'root';
        this.activeFilter = null;
        this.renderDrives();
        this.renderCurrentFolder();
      });
    });
  }

  private async renderCurrentFolder() {
    this.renderBreadcrumbs();
    this.folders = await this.api.getFolders(this.activeDrive, this.currentFolderId);
    this.files = await this.api.getFiles(this.activeDrive, this.currentFolderId, this.activeFilter || undefined);

    const foldersGrid = document.getElementById('foldersGrid');
    const foldersSection = document.getElementById('foldersSection');
    if (foldersGrid && foldersSection) {
      if (this.folders.length === 0) {
        foldersSection.style.display = 'none';
      } else {
        foldersSection.style.display = 'block';
        foldersGrid.innerHTML = this.folders
          .map(
            (f) => `
          <div class="folder-card" data-id="${f.id}">
            <div class="folder-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            </div>
            <div class="folder-details">
              <span class="folder-name">${f.name}</span>
              <span class="folder-count">${f.count || '0 files'}</span>
            </div>
          </div>
        `
          )
          .join('');

        foldersGrid.querySelectorAll('.folder-card').forEach((card) => {
          card.addEventListener('click', () => {
            const folderId = card.getAttribute('data-id');
            if (folderId) {
              this.currentFolderId = folderId;
              this.renderCurrentFolder();
            }
          });
        });
      }
    }

    const filesList = document.getElementById('filesList');
    if (filesList) {
      if (this.files.length === 0) {
        filesList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-secondary);">No files found in this directory.</div>`;
      } else {
        filesList.innerHTML = this.files
          .map(
            (f) => `
          <div class="file-row" data-id="${f.id}">
            <div class="file-icon-box ${f.type}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${this.getFileIcon(f.type)}</svg>
            </div>
            <span class="file-name">${f.name}</span>
            <span class="file-meta-col" style="font-family: var(--font-mono);">${f.size}</span>
            <span class="file-meta-col">${f.date}</span>
            ${f.encrypted ? '<span class="file-badge encrypted">Encrypted</span>' : ''}
            ${f.pinned ? '<span class="file-badge pinned">Pinned</span>' : ''}
          </div>
        `
          )
          .join('');

        filesList.querySelectorAll('.file-row').forEach((row) => {
          row.addEventListener('click', () => {
            const fileId = row.getAttribute('data-id');
            const file = this.files.find((f) => f.id === fileId);
            if (file) this.openPreviewModal(file);
          });
        });
      }
    }
  }

  private renderBreadcrumbs() {
    const bar = document.getElementById('breadcrumbsBar');
    if (!bar) return;

    const drive = this.drives.find((d) => d.id === this.activeDrive);
    let html = `<button class="crumb-btn ${this.currentFolderId === 'root' ? 'active' : ''}" id="crumbRoot">${drive?.name || 'Drive'}</button>`;

    if (this.currentFolderId !== 'root') {
      const activeFolder = this.folders.find((f) => f.id === this.currentFolderId);
      html += `<span class="crumb-sep">/</span><button class="crumb-btn active">${activeFolder?.name || 'Folder'}</button>`;
    }

    bar.innerHTML = html;
    document.getElementById('crumbRoot')?.addEventListener('click', () => {
      this.currentFolderId = 'root';
      this.renderCurrentFolder();
    });
  }

  private getFileIcon(type: string): string {
    switch (type) {
      case 'video':
        return '<polygon points="5 3 19 12 5 21 5 3"/>';
      case 'image':
        return '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>';
      case 'pdf':
        return '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>';
      case 'audio':
        return '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
      case 'sheet':
        return '<rect width="18" height="18" x="3" y="3" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/>';
      default:
        return '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>';
    }
  }

  private openPreviewModal(file: FileNode) {
    const modalsRoot = document.getElementById('modalsRoot');
    if (!modalsRoot) return;

    modalsRoot.innerHTML = `
      <div class="modal-overlay" id="previewModal">
        <div class="modal-card">
          <div class="modal-header">
            <span class="modal-title">${file.name}</span>
            <button class="modal-close-btn" id="closePreviewBtn">✕</button>
          </div>
          <div class="modal-body">
            <div style="height: 180px; background: #000000; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 48px; height: 48px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <div>
              <p><strong>Size:</strong> ${file.size}</p>
              <p><strong>Encryption:</strong> ${file.encrypted ? 'Client-side AEAD (AES-256-GCM via STREAM)' : 'Plaintext'}</p>
              <p><strong>Telegram ID:</strong> Message #${file.telegram_message_id} (DC4)</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-action secondary" id="btnPinFile">${file.pinned ? 'Unpin from Device' : 'Keep Offline (Pin)'}</button>
            <button class="btn-action primary" id="closePreviewBtn2">Done</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('closePreviewBtn')?.addEventListener('click', () => this.closeModals());
    document.getElementById('closePreviewBtn2')?.addEventListener('click', () => this.closeModals());
    document.getElementById('btnPinFile')?.addEventListener('click', async () => {
      await this.api.togglePin(file.id);
      this.closeModals();
      this.renderCurrentFolder();
    });
  }

  private closeModals() {
    const modalsRoot = document.getElementById('modalsRoot');
    if (modalsRoot) modalsRoot.innerHTML = '';
  }

  private bindEvents() {
    // Theme toggle
    document.getElementById('btnTheme')?.addEventListener('click', () => {
      this.themeManager.toggleTheme();
    });

    // Palette picker
    document.getElementById('btnPalette')?.addEventListener('click', () => {
      const modalsRoot = document.getElementById('modalsRoot');
      if (!modalsRoot) return;

      modalsRoot.innerHTML = `
        <div class="modal-overlay" id="paletteModal">
          <div class="modal-card">
            <div class="modal-header">
              <span class="modal-title">Color Themes (WCAG AA)</span>
              <button class="modal-close-btn" id="closePaletteBtn">✕</button>
            </div>
            <div class="modal-body">
              ${PALETTES.map(
                (p) => `
                <button class="nav-item palette-btn" data-p="${p.id}" style="padding: 10px; border-radius: 8px;">
                  <span style="font-weight: 600;">${p.name}</span>
                  <span style="margin-left: auto; font-size: 11px; color: var(--text-secondary);">${p.desc}</span>
                </button>
              `
              ).join('')}
            </div>
          </div>
        </div>
      `;

      document.getElementById('closePaletteBtn')?.addEventListener('click', () => this.closeModals());
      document.querySelectorAll('.palette-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pal = btn.getAttribute('data-p') as Palette;
          if (pal) this.themeManager.setPalette(pal);
          this.closeModals();
        });
      });
    });

    // Search filter
    const searchInput = document.getElementById('globalSearchInput') as HTMLInputElement;
    searchInput?.addEventListener('input', async (e) => {
      const q = (e.target as HTMLInputElement).value.trim();
      if (q) {
        const results = await this.api.search(this.activeDrive, q);
        const filesList = document.getElementById('filesList');
        if (filesList) {
          filesList.innerHTML = results
            .map(
              (r) => `
            <div class="file-row">
              <span class="file-badge">${r.kind}</span>
              <span class="file-name">${r.name}</span>
            </div>
          `
            )
            .join('');
        }
      } else {
        this.renderCurrentFolder();
      }
    });

    // New folder button
    document.getElementById('btnNewFolder')?.addEventListener('click', async () => {
      const name = prompt('Enter new folder name:');
      if (name && name.trim()) {
        await this.api.createFolder(this.activeDrive, this.currentFolderId, name.trim());
        this.renderCurrentFolder();
      }
    });

    // Storage card
    document.getElementById('btnStorageCard')?.addEventListener('click', () => {
      alert('ProtoFS Storage: Unlimited Telegram cloud channels. Local SQLite cache size: 310 MB.');
    });

    // Sync pairs dialog
    document.getElementById('btnSyncPairs')?.addEventListener('click', () => {
      alert('Sync Pairs Active: 2 folders registered with native OS file watchers.');
    });

    // Keyboard shortcut Ctrl+K
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
      if (e.key === 'Escape') {
        this.closeModals();
      }
    });
  }
}

new ProtoFsApp();
