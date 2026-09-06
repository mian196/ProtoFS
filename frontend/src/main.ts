import './style.css';
import { ProtoFsApi } from './api';
import { ThemeManager, PALETTES } from './theme';
import type { Palette } from './theme';
import type { AuthSession, DriveMetadata, FileNode, FolderNode, SearchResult, SyncPair } from './types';

type MobileTab = 'files' | 'camera' | 'transfers' | 'settings';

class ProtoFsApp {
  private api = new ProtoFsApi();
  private themeManager = new ThemeManager();

  private session: AuthSession | null = null;
  private activeDriveId = 'personal';
  private currentFolderId = 'root';
  private activeFilter: string | null = null;
  private isMobileMode = false;

  private drives: DriveMetadata[] = [];
  private folders: FolderNode[] = [];
  private files: FileNode[] = [];
  private syncPairs: SyncPair[] = [];

  // Login flow state
  private loginStep: 'credentials' | 'code' = 'credentials';
  private loginPhone = '';
  private loginApiId = '';
  private loginApiHash = '';

  constructor() {
    this.themeManager.init();
    this.bootstrap();
  }

  private async bootstrap() {
    this.session = await this.api.getSessionStatus();
    if (!this.session || !this.session.is_authenticated) {
      this.renderLoginScreen();
    } else {
      this.activeDriveId = this.session.active_drive_id || 'personal';
      await this.initWorkspace();
    }
  }

  // -------------------------------------------------------------------------
  // TELEGRAM MTPROTO ONBOARDING & LOGIN SCREEN (PRD Section 6.1 & 6.18)
  // -------------------------------------------------------------------------

  private renderLoginScreen() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <div class="login-brand">
            <div class="login-logo">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
              </svg>
            </div>
            <h1 class="login-title">ProtoFS Cloud Drive</h1>
            <p class="login-subtitle">Unlimited, zero-knowledge encrypted cloud storage powered directly by your private Telegram channels.</p>
          </div>

          <div class="login-step-badges">
            <span class="step-badge ${this.loginStep === 'credentials' ? 'active' : ''}">1. Telegram Auth</span>
            <span class="step-badge ${this.loginStep === 'code' ? 'active' : ''}">2. Security Code</span>
          </div>

          ${
            this.loginStep === 'credentials'
              ? `
            <form class="login-form" id="formCredentials">
              <div class="form-group">
                <label class="form-label">
                  <span>API ID & API Hash</span>
                  <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer">my.telegram.org ↗</a>
                </label>
                <div style="display: flex; gap: 8px;">
                  <input type="text" class="form-input" id="inputApiId" placeholder="API ID (e.g. 20401928)" style="flex: 1;" required>
                  <input type="password" class="form-input" id="inputApiHash" placeholder="API Hash (e.g. 3a9f...)" style="flex: 1.5;" required>
                </div>
              </div>

              <button type="button" class="demo-credentials-btn" id="btnQuickDemo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span>Use Quick Test / Demo Credentials</span>
              </button>

              <div class="form-group">
                <label class="form-label">Telegram Phone Number</label>
                <input type="tel" class="form-input" id="inputPhone" placeholder="+1 202 555 0192" required>
              </div>

              <div class="login-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>Keys are stored locally only and never sent to any external server. ProtoFS talks directly to Telegram's native MTProto servers.</span>
              </div>

              <button type="submit" class="btn-primary-tg" id="btnSendCode">
                <span>Request Login Code</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </form>
          `
              : `
            <form class="login-form" id="formVerifyCode">
              <div class="form-group">
                <label class="form-label">Verification Code</label>
                <input type="text" class="form-input" id="inputCode" placeholder="Enter 5-digit Telegram code" required autofocus>
                <span style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Code sent via Telegram chat to ${this.loginPhone}</span>
              </div>

              <div class="form-group">
                <label class="form-label">
                  <span>2FA Cloud Password (Optional)</span>
                  <span style="color: var(--text-muted); font-size: 11px;">If enabled</span>
                </label>
                <input type="password" class="form-input" id="input2fa" placeholder="Two-Step Verification Password">
              </div>

              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-action secondary" id="btnBackToPhone" style="flex: 1;">Back</button>
                <button type="submit" class="btn-primary-tg" style="flex: 2;">
                  <span>Enter ProtoFS Drive</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </form>
          `
          }
        </div>
      </div>
    `;

    this.bindLoginEvents();
  }

  private bindLoginEvents() {
    const btnQuickDemo = document.getElementById('btnQuickDemo');
    if (btnQuickDemo) {
      btnQuickDemo.addEventListener('click', () => {
        const idEl = document.getElementById('inputApiId') as HTMLInputElement;
        const hashEl = document.getElementById('inputApiHash') as HTMLInputElement;
        const phoneEl = document.getElementById('inputPhone') as HTMLInputElement;
        if (idEl && hashEl && phoneEl) {
          idEl.value = '20491820';
          hashEl.value = 'e8b7c6d5a4f3210987654321fedcba09';
          phoneEl.value = '+1 (202) 555-0196';
        }
      });
    }

    const formCredentials = document.getElementById('formCredentials');
    if (formCredentials) {
      formCredentials.addEventListener('submit', async e => {
        e.preventDefault();
        const idEl = document.getElementById('inputApiId') as HTMLInputElement;
        const hashEl = document.getElementById('inputApiHash') as HTMLInputElement;
        const phoneEl = document.getElementById('inputPhone') as HTMLInputElement;

        this.loginApiId = idEl.value.trim();
        this.loginApiHash = hashEl.value.trim();
        this.loginPhone = phoneEl.value.trim();

        try {
          await this.api.loginSendCode(this.loginPhone, this.loginApiId, this.loginApiHash);
          this.loginStep = 'code';
          this.renderLoginScreen();
        } catch (err: any) {
          alert(`Login error: ${err.message}`);
        }
      });
    }

    const btnBackToPhone = document.getElementById('btnBackToPhone');
    if (btnBackToPhone) {
      btnBackToPhone.addEventListener('click', () => {
        this.loginStep = 'credentials';
        this.renderLoginScreen();
      });
    }

    const formVerifyCode = document.getElementById('formVerifyCode');
    if (formVerifyCode) {
      formVerifyCode.addEventListener('submit', async e => {
        e.preventDefault();
        const codeEl = document.getElementById('inputCode') as HTMLInputElement;
        const twoFaEl = document.getElementById('input2fa') as HTMLInputElement;

        try {
          const session = await this.api.loginVerifyCode(
            this.loginPhone,
            this.loginApiId,
            this.loginApiHash,
            codeEl.value.trim(),
            twoFaEl ? twoFaEl.value.trim() : undefined
          );
          this.session = session;
          this.activeDriveId = session.active_drive_id || 'personal';
          await this.initWorkspace();
        } catch (err: any) {
          alert(`Verification error: ${err.message}`);
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // MAIN WORKSPACE & FILE EXPLORER
  // -------------------------------------------------------------------------

  private async initWorkspace() {
    this.renderAppShell();
    this.bindEvents();
    await this.loadWorkspaceData();
  }

  private renderAppShell() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const userInitial = this.session?.first_name ? this.session.first_name.slice(0, 2).toUpperCase() : 'MZ';
    const userName = this.session?.username ? `@${this.session.username}` : (this.session?.phone || 'Connected');

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
          <button class="icon-btn" id="btnDeviceView" title="Toggle Desktop / Mobile View" aria-label="Toggle Desktop or Mobile View">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
          </button>
          <button class="icon-btn" id="btnPalette" title="Color Themes" aria-label="Choose color palette">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          </button>
          <button class="icon-btn" id="btnTheme" title="Toggle Light/Dark Mode" aria-label="Toggle Light and Dark Mode">
            <svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>
          </button>
          <button class="icon-btn" id="btnSyncPairs" title="Sync Pairs" aria-label="Sync Pairs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          </button>

          <!-- User Profile & Dropdown -->
          <div class="account-menu-wrapper">
            <div class="user-avatar" id="btnAvatar" title="Account Details" style="cursor: pointer;">
              <span>${userInitial}</span>
            </div>
            <div class="account-dropdown hidden" id="accountDropdown">
              <div class="account-dropdown-header">
                <span class="account-user-name">${this.session?.first_name || 'ProtoFS User'}</span>
                <span class="account-user-phone">${userName}</span>
              </div>
              <button class="account-menu-item" id="btnAccountSettings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Encryption & Keys</span>
              </button>
              <button class="account-menu-item danger" id="btnLogout">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Log Out / Disconnect</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Main Workspace -->
      <div class="workspace-container" id="workspaceContainer">
        <!-- Sidebar -->
        <aside class="sidebar" id="mainSidebar">
          <div>
            <div class="sidebar-section-title">
              <span>Drives</span>
              <button class="icon-btn" id="btnNewDrive" title="New Drive" style="width:22px;height:22px;">+</button>
            </div>
            <nav class="nav-list" id="drivesNavList"></nav>

            <div class="sidebar-section-title" style="margin-top: 20px;">
              <span>Filters</span>
            </div>
            <nav class="nav-list">
              <button class="nav-item ${this.activeFilter === null ? 'active' : ''}" data-filter="all">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span>All Files</span>
              </button>
              <button class="nav-item ${this.activeFilter === 'pinned' ? 'active' : ''}" data-filter="pinned">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
                <span>Offline Pinned</span>
              </button>
              <button class="nav-item ${this.activeFilter === 'encrypted' ? 'active' : ''}" data-filter="encrypted">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>Encrypted Vaults</span>
              </button>
              <button class="nav-item ${this.activeFilter === 'trash' ? 'active' : ''}" data-filter="trash">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                <span>Trash</span>
              </button>
            </nav>
          </div>

          <!-- Storage Card -->
          <div class="storage-card" id="btnStorageCard">
            <div class="storage-card-header">
              <span>Cloud Storage</span>
              <span style="color: var(--accent-primary);" id="storageUsageText">Calculating...</span>
            </div>
            <div class="storage-bar">
              <div class="storage-bar-fill" style="width: 25%;"></div>
            </div>
            <div class="storage-sub">Telegram Channel: Unlimited Quota</div>
          </div>
        </aside>

        <!-- Main Explorer View -->
        <main class="main-view" id="mainView">
          <!-- Toolbar -->
          <div class="action-toolbar">
            <div class="breadcrumbs-bar" id="breadcrumbsBar"></div>
            <div class="toolbar-buttons" id="toolbarButtons">
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
          <div class="browser-viewport" id="browserViewport">
            <!-- TAB: FILES -->
            <div id="tabContentFiles">
              <div id="foldersSection">
                <div class="section-label">Folders</div>
                <div class="folder-grid" id="foldersGrid"></div>
              </div>

              <div id="filesSection" style="margin-top: 20px;">
                <div class="section-label" id="filesSectionLabel">Files</div>
                <div class="file-list" id="filesList"></div>
              </div>
            </div>

            <!-- TAB: CAMERA (Mobile) -->
            <div id="tabContentCamera" style="display: none;">
              <div class="camera-card" style="background: var(--bg-surface); padding: 18px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 16px;">
                <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 4px;">Camera Auto-Backup Active</h3>
                <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Syncing DCIM/Camera to Telegram Channel via Android WorkManager.</p>
                <div style="font-size: 12px; color: var(--color-success); font-weight: 600;">1,420 Photos Synced | WiFi Only</div>
              </div>
            </div>

            <!-- TAB: TRANSFERS -->
            <div id="tabContentTransfers" style="display: none;">
              <div class="section-label">Active Transfers (MTProto Chunk Streams)</div>
              <div id="transfersList">
                <div class="file-row" style="cursor: default;">
                  <div class="file-icon-box file-type-video">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/></svg>
                  </div>
                  <div class="file-details">
                    <span class="file-name">Cyberpunk_2077_NightCity_4K.mp4</span>
                    <span class="file-meta">Uploading 64KB chunks | 1.84 GB | 92%</span>
                  </div>
                  <div class="pill-badge pill-active">92%</div>
                </div>
              </div>
            </div>

            <!-- TAB: SETTINGS -->
            <div id="tabContentSettings" style="display: none;">
              <div class="section-label">ProtoFS Configuration</div>
              <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px;">
                <div style="margin-bottom: 12px;">
                  <div style="font-size: 13px; font-weight: 600;">FUSE / WinFsp Mount Drive</div>
                  <div style="font-size: 12px; color: var(--text-secondary);">Native Explorer Drive Letter (P:)</div>
                </div>
                <div style="margin-bottom: 12px;">
                  <div style="font-size: 13px; font-weight: 600;">Client-Side Encryption</div>
                  <div style="font-size: 12px; color: var(--text-secondary);">AES-256-GCM (Argon2id KDF) Enabled</div>
                </div>
                <div>
                  <div style="font-size: 13px; font-weight: 600;">SQLite FTS5 Local Cache</div>
                  <div style="font-size: 12px; color: var(--text-secondary);">WAL Mode Active | Sub-5ms Queries</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Mobile Bottom Navigation -->
          <nav class="mobile-nav" id="mobileBottomNav" style="display: none;">
            <button class="mobile-nav-item active" data-tab="files">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
              <span>Files</span>
            </button>
            <button class="mobile-nav-item" data-tab="camera">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <span>Camera</span>
            </button>
            <button class="mobile-nav-item" data-tab="transfers">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Transfers</span>
            </button>
            <button class="mobile-nav-item" data-tab="settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>Settings</span>
            </button>
          </nav>
        </main>
      </div>

      <!-- Generic Dynamic Modal -->
      <div class="modal-overlay hidden" id="dynamicModalOverlay">
        <div class="modal-card" id="dynamicModalCard">
          <div class="modal-header">
            <span class="modal-title" id="dynamicModalTitle">Dialog</span>
            <button class="modal-close-btn" id="btnDynamicModalClose">✕</button>
          </div>
          <div class="modal-body" id="dynamicModalBody"></div>
          <div class="modal-footer" id="dynamicModalFooter"></div>
        </div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // DATA LOADING & RENDERING
  // -------------------------------------------------------------------------

  private async loadWorkspaceData() {
    this.drives = await this.api.getDrives();
    const activeDrive = this.drives.find(d => d.id === this.activeDriveId) || this.drives[0];
    if (activeDrive) {
      this.activeDriveId = activeDrive.id;
      const data = await this.api.loadDrive(activeDrive.id, activeDrive.channel_id);
      this.folders = data.folders;
      this.files = data.files;
    }
    this.syncPairs = await this.api.getSyncPairs();

    this.renderDrivesNav();
    this.renderBreadcrumbs();
    this.renderContent();
    this.updateStorageUsage();
  }

  private renderDrivesNav() {
    const listEl = document.getElementById('drivesNavList');
    if (!listEl) return;

    listEl.innerHTML = this.drives
      .map(
        d => `
        <button class="nav-item ${d.id === this.activeDriveId && this.activeFilter === null ? 'active' : ''}" data-drive-id="${d.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
          <span>${escapeHtml(d.name)}</span>
        </button>
      `
      )
      .join('');

    listEl.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dId = (btn as HTMLElement).dataset.driveId;
        if (dId) {
          this.activeDriveId = dId;
          this.currentFolderId = 'root';
          this.activeFilter = null;
          await this.loadWorkspaceData();
        }
      });
    });
  }

  private renderBreadcrumbs() {
    const bar = document.getElementById('breadcrumbsBar');
    if (!bar) return;

    const drive = this.drives.find(d => d.id === this.activeDriveId);
    const driveName = drive ? drive.name : 'Drive';

    if (this.activeFilter === 'trash') {
      bar.innerHTML = `<span>${driveName}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Trash / Recycle Bin</span>`;
      return;
    }
    if (this.activeFilter === 'pinned') {
      bar.innerHTML = `<span>${driveName}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Offline Pinned</span>`;
      return;
    }
    if (this.activeFilter === 'encrypted') {
      bar.innerHTML = `<span>${driveName}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Encrypted Vaults</span>`;
      return;
    }

    const crumbs: { id: string; name: string }[] = [{ id: 'root', name: driveName }];
    let curr = this.currentFolderId;
    const pathStack: { id: string; name: string }[] = [];

    while (curr !== 'root') {
      const f = this.folders.find(folder => folder.id === curr);
      if (f) {
        pathStack.push({ id: f.id, name: f.name });
        curr = f.parent_id;
      } else {
        break;
      }
    }
    pathStack.reverse();
    crumbs.push(...pathStack);

    bar.innerHTML = crumbs
      .map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return isLast
          ? `<span class="crumb-item active">${escapeHtml(c.name)}</span>`
          : `<span class="crumb-item" data-crumb-id="${c.id}">${escapeHtml(c.name)}</span><span class="crumb-sep">/</span>`;
      })
      .join('');

    bar.querySelectorAll('.crumb-item[data-crumb-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.crumbId;
        if (id) {
          this.currentFolderId = id;
          this.renderBreadcrumbs();
          this.renderContent();
        }
      });
    });
  }

  private renderContent() {
    const foldersSection = document.getElementById('foldersSection');
    const foldersGrid = document.getElementById('foldersGrid');
    const filesList = document.getElementById('filesList');
    const filesSectionLabel = document.getElementById('filesSectionLabel');
    const toolbarButtons = document.getElementById('toolbarButtons');

    if (!foldersGrid || !filesList) return;

    if (this.activeFilter === 'trash') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Trash / Recycle Bin (Soft-Deleted Items)';
      if (toolbarButtons) {
        toolbarButtons.innerHTML = `
          <button class="btn-action danger" id="btnEmptyTrash">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span>Empty Trash</span>
          </button>
        `;
        const btnEmpty = document.getElementById('btnEmptyTrash');
        btnEmpty?.addEventListener('click', () => this.handleEmptyTrash());
      }

      const trashedFiles = this.files.filter(f => f.trashed);
      if (trashedFiles.length === 0) {
        filesList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">Trash is empty. Deleted files are retained for 30 days.</div>`;
      } else {
        filesList.innerHTML = trashedFiles.map(f => this.renderFileRow(f, true)).join('');
        this.bindFileRowActions(true);
      }
      return;
    }

    // Normal mode / other filters
    if (toolbarButtons) {
      toolbarButtons.innerHTML = `
        <button class="btn-action secondary" id="btnNewFolder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          <span>New Folder</span>
        </button>
        <button class="btn-action primary" id="btnUpload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Upload</span>
        </button>
      `;
      document.getElementById('btnNewFolder')?.addEventListener('click', () => this.openNewFolderModal());
      document.getElementById('btnUpload')?.addEventListener('click', () => this.openUploadModal());
    }

    if (this.activeFilter === 'pinned') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Offline Pinned Files (Protected from LRU Eviction)';
      const pinned = this.files.filter(f => !f.trashed && f.pinned);
      filesList.innerHTML = pinned.length
        ? pinned.map(f => this.renderFileRow(f)).join('')
        : `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No pinned files. Pin items to keep them accessible offline.</div>`;
      this.bindFileRowActions();
      return;
    }

    if (this.activeFilter === 'encrypted') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Encrypted Vault Files (AES-256-GCM 64KB Chunk Stream)';
      const enc = this.files.filter(f => !f.trashed && f.encrypted);
      filesList.innerHTML = enc.length
        ? enc.map(f => this.renderFileRow(f)).join('')
        : `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No encrypted files in this drive.</div>`;
      this.bindFileRowActions();
      return;
    }

    // Default view: Show folders for current folder
    if (foldersSection) foldersSection.style.display = 'block';
    if (filesSectionLabel) filesSectionLabel.textContent = 'Files';

    const childFolders = this.folders.filter(f => f.parent_id === this.currentFolderId);
    if (childFolders.length === 0) {
      foldersGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 12px; font-size: 12px; color: var(--text-muted);">No subfolders here. Click "+ New Folder" to create one.</div>`;
    } else {
      foldersGrid.innerHTML = childFolders
        .map(
          f => `
          <div class="folder-card" data-folder-id="${f.id}">
            <div class="folder-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            </div>
            <div class="folder-title">${escapeHtml(f.name)}</div>
            <div class="folder-meta">${escapeHtml(f.count || 'Folder')}</div>
          </div>
        `
        )
        .join('');

      foldersGrid.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', () => {
          const fId = (card as HTMLElement).dataset.folderId;
          if (fId) {
            this.currentFolderId = fId;
            this.renderBreadcrumbs();
            this.renderContent();
          }
        });
      });
    }

    // Files in current folder
    const childFiles = this.files.filter(f => !f.trashed && f.parent_id === this.currentFolderId);
    if (childFiles.length === 0) {
      filesList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No files in this folder. Click "+ Upload" to add one.</div>`;
    } else {
      filesList.innerHTML = childFiles.map(f => this.renderFileRow(f)).join('');
      this.bindFileRowActions();
    }
  }

  private renderFileRow(f: FileNode, isTrash = false): string {
    const iconClass = `file-type-${f.type}`;
    const iconSvg = getFileIconSvg(f.type);

    return `
      <div class="file-row" data-file-id="${f.id}">
        <div class="file-icon-box ${iconClass}">${iconSvg}</div>
        <div class="file-details">
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-meta">${f.size} • ${f.date} ${f.encrypted ? '• 🔒 Encrypted' : ''} ${f.pinned ? '• 📌 Pinned' : ''}</span>
        </div>
        <div class="file-actions-group">
          ${
            isTrash
              ? `
            <button class="btn-icon-subtle btn-restore-file" data-id="${f.id}" title="Restore File">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            </button>
            <button class="btn-icon-subtle btn-delete-file-perm" data-id="${f.id}" title="Delete Permanently" style="color: var(--color-danger);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          `
              : `
            <button class="btn-icon-subtle btn-preview-file" data-id="${f.id}" title="Preview">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="btn-icon-subtle btn-pin-file" data-id="${f.id}" title="${f.pinned ? 'Unpin Offline' : 'Pin Offline'}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${f.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            </button>
            <button class="btn-icon-subtle btn-trash-file" data-id="${f.id}" title="Move to Trash">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          `
          }
        </div>
      </div>
    `;
  }

  private bindFileRowActions(isTrash = false) {
    if (isTrash) {
      document.querySelectorAll('.btn-restore-file').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) {
            await this.api.restoreNode(this.activeDriveId, id);
            await this.loadWorkspaceData();
          }
        });
      });
      document.querySelectorAll('.btn-delete-file-perm').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id && confirm('Permanently delete this message from Telegram?')) {
            await this.api.deleteNode(this.activeDriveId, id, true);
            await this.loadWorkspaceData();
          }
        });
      });
    } else {
      document.querySelectorAll('.btn-preview-file').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          const file = this.files.find(f => f.id === id);
          if (file) this.openFilePreview(file);
        });
      });
      document.querySelectorAll('.btn-pin-file').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          const file = this.files.find(f => f.id === id);
          if (file) {
            await this.api.togglePin(this.activeDriveId, id!, !file.pinned);
            await this.loadWorkspaceData();
          }
        });
      });
      document.querySelectorAll('.btn-trash-file').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) {
            await this.api.deleteNode(this.activeDriveId, id, false);
            await this.loadWorkspaceData();
          }
        });
      });
    }
  }

  private updateStorageUsage() {
    const textEl = document.getElementById('storageUsageText');
    if (!textEl) return;
    const totalBytes = this.files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    textEl.textContent = formatBytes(totalBytes);
  }

  // -------------------------------------------------------------------------
  // MODALS & ACTIONS (New Folder, Upload, Preview, New Drive, Sync Pairs)
  // -------------------------------------------------------------------------

  private openNewFolderModal() {
    this.showModal('Create New Folder', `
      <div class="form-group">
        <label class="form-label">Folder Name</label>
        <input type="text" class="form-input" id="inputModalFolderName" placeholder="e.g. Invoices 2026" autofocus>
      </div>
    `, `
      <button class="btn-action secondary" id="btnModalCancel">Cancel</button>
      <button class="btn-action primary" id="btnModalCreateFolder">Create Folder</button>
    `);

    document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnModalCreateFolder')?.addEventListener('click', async () => {
      const input = document.getElementById('inputModalFolderName') as HTMLInputElement;
      const name = input?.value.trim();
      if (!name) return;
      await this.api.createFolder(this.activeDriveId, this.currentFolderId, name);
      this.closeModal();
      await this.loadWorkspaceData();
    });
  }

  private openUploadModal() {
    this.showModal('Upload File to Drive', `
      <div class="form-group">
        <label class="form-label">File Name</label>
        <input type="text" class="form-input" id="inputModalFileName" placeholder="e.g. database_backup.tar.gz" required>
      </div>
      <div class="form-group">
        <label class="form-label">Estimated File Size (MB)</label>
        <input type="number" class="form-input" id="inputModalFileSize" value="25" min="1" max="4000">
      </div>
      <div style="background: var(--bg-surface-elevated); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">Zero-Knowledge Encryption</div>
          <div style="font-size: 11px; color: var(--text-secondary);">64KB chunked AES-256-GCM authenticated stream</div>
        </div>
        <input type="checkbox" id="checkModalEncrypt" checked style="width: 18px; height: 18px; cursor: pointer;">
      </div>
    `, `
      <button class="btn-action secondary" id="btnModalCancel">Cancel</button>
      <button class="btn-action primary" id="btnModalDoUpload">Upload to Telegram</button>
    `);

    document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnModalDoUpload')?.addEventListener('click', async () => {
      const nameEl = document.getElementById('inputModalFileName') as HTMLInputElement;
      const sizeEl = document.getElementById('inputModalFileSize') as HTMLInputElement;
      const encEl = document.getElementById('checkModalEncrypt') as HTMLInputElement;

      const name = nameEl?.value.trim();
      if (!name) return;
      const sizeMb = parseFloat(sizeEl?.value || '10');
      const sizeBytes = Math.round(sizeMb * 1024 * 1024);
      const isEncrypted = encEl?.checked || false;

      await this.api.uploadFile(this.activeDriveId, this.currentFolderId, name, sizeBytes, isEncrypted);
      this.closeModal();
      await this.loadWorkspaceData();
    });
  }

  private openNewDriveModal() {
    this.showModal('Add New Drive / Channel', `
      <div class="form-group">
        <label class="form-label">Drive Name</label>
        <input type="text" class="form-input" id="inputModalDriveName" placeholder="e.g. Photography Archive" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">Telegram Channel ID</label>
        <input type="number" class="form-input" id="inputModalChannelId" placeholder="-1001928472910" required>
        <span style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ProtoFS will pin a compressed manifest.json.zst in this channel.</span>
      </div>
    `, `
      <button class="btn-action secondary" id="btnModalCancel">Cancel</button>
      <button class="btn-action primary" id="btnModalCreateDrive">Create Drive</button>
    `);

    document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnModalCreateDrive')?.addEventListener('click', async () => {
      const nameEl = document.getElementById('inputModalDriveName') as HTMLInputElement;
      const chEl = document.getElementById('inputModalChannelId') as HTMLInputElement;
      const name = nameEl?.value.trim();
      const channelId = parseInt(chEl?.value.trim() || '0', 10);
      if (!name || !channelId) return;

      const newDrive = await this.api.createDrive(name, channelId);
      this.activeDriveId = newDrive.id;
      this.closeModal();
      await this.loadWorkspaceData();
    });
  }

  private openFilePreview(file: FileNode) {
    let previewContent = '';
    if (file.type === 'video') {
      previewContent = `
        <div style="background: #000; border-radius: var(--radius-sm); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 220px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span style="font-size: 12px; color: #aaa; margin-top: 8px;">64KB HTTP 206 Range Stream Playback</span>
        </div>
      `;
    } else if (file.type === 'image') {
      previewContent = `
        <div style="background: var(--bg-surface-elevated); border-radius: var(--radius-sm); padding: 32px; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary);"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          <div style="font-size: 13px; font-weight: 600; margin-top: 8px;">${escapeHtml(file.name)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">Decrypted from Telegram CDN</div>
        </div>
      `;
    } else {
      previewContent = `
        <div style="background: var(--bg-surface-elevated); border-radius: var(--radius-sm); padding: 24px; font-family: var(--font-mono); font-size: 12px;">
          <div>File ID: ${file.id}</div>
          <div>Size: ${file.size} (${file.size_bytes} bytes)</div>
          <div>SHA-256: ${file.sha256_hash || 'Verified'}</div>
          <div>Telegram Message ID: #${file.telegram_message_id}</div>
          <div>Encrypted: ${file.encrypted ? 'AES-256-GCM (STREAM Construction)' : 'No'}</div>
        </div>
      `;
    }

    this.showModal(`Preview: ${file.name}`, previewContent, `
      <button class="btn-action secondary" id="btnModalCancel">Close</button>
      <button class="btn-action primary" id="btnDownloadMock">Download File</button>
    `);

    document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnDownloadMock')?.addEventListener('click', () => {
      alert(`Downloading ${file.name} via Telegram MTProto chunk stream...`);
      this.closeModal();
    });
  }

  private openSyncPairsModal() {
    const listHtml = this.syncPairs
      .map(
        p => `
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text-primary); font-family: var(--font-mono);">${escapeHtml(p.local_path)}</span>
            <span class="pill-badge pill-active">${escapeHtml(p.sync_mode.toUpperCase())}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-secondary);">${p.status} • ${p.file_count} files</div>
        </div>
      `
      )
      .join('');

    this.showModal('Sync Pairs (Real-Time OS Watcher)', `
      <div style="margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
        Active folders automatically monitored for changes and synced to your Telegram Drive.
      </div>
      <div>${listHtml}</div>
    `, `
      <button class="btn-action secondary" id="btnModalCancel">Close</button>
      <button class="btn-action primary" id="btnTriggerSyncNow">Sync Now</button>
    `);

    document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnTriggerSyncNow')?.addEventListener('click', () => {
      alert('Triggered real-time folder sync against local SQLite cache.');
      this.closeModal();
    });
  }

  private async handleEmptyTrash() {
    if (confirm('Permanently delete all items in the Trash from Telegram?')) {
      const count = await this.api.emptyTrash(this.activeDriveId);
      alert(`Emptied ${count} items from Trash.`);
      await this.loadWorkspaceData();
    }
  }

  private showModal(title: string, bodyHtml: string, footerHtml: string) {
    const overlay = document.getElementById('dynamicModalOverlay');
    const titleEl = document.getElementById('dynamicModalTitle');
    const bodyEl = document.getElementById('dynamicModalBody');
    const footerEl = document.getElementById('dynamicModalFooter');

    if (overlay && titleEl && bodyEl && footerEl) {
      titleEl.textContent = title;
      bodyEl.innerHTML = bodyHtml;
      footerEl.innerHTML = footerHtml;
      overlay.classList.remove('hidden');

      document.getElementById('btnDynamicModalClose')?.addEventListener('click', () => this.closeModal());
    }
  }

  private closeModal() {
    const overlay = document.getElementById('dynamicModalOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // -------------------------------------------------------------------------
  // GLOBAL EVENTS & SHORTCUTS
  // -------------------------------------------------------------------------

  private bindEvents() {
    // Search input (SQLite FTS5 sub-5ms search)
    const searchInput = document.getElementById('globalSearchInput') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', async () => {
        const q = searchInput.value.trim();
        if (q.length > 0) {
          const results = await this.api.searchNodes(this.activeDriveId, q);
          this.renderSearchResults(results);
        } else {
          this.renderContent();
        }
      });
    }

    // Ctrl+K hotkey for instant search
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.getElementById('globalSearchInput');
        input?.focus();
      }
    });

    // Device view switcher (Desktop vs Android layout)
    document.getElementById('btnDeviceView')?.addEventListener('click', () => {
      this.isMobileMode = !this.isMobileMode;
      const ws = document.getElementById('workspaceContainer');
      const mobileNav = document.getElementById('mobileBottomNav');
      if (this.isMobileMode) {
        ws?.classList.add('mobile-layout');
        if (mobileNav) mobileNav.style.display = 'flex';
      } else {
        ws?.classList.remove('mobile-layout');
        if (mobileNav) mobileNav.style.display = 'none';
      }
    });

    // Theme toggle
    document.getElementById('btnTheme')?.addEventListener('click', () => {
      this.themeManager.toggleTheme();
    });

    // Palette switcher
    document.getElementById('btnPalette')?.addEventListener('click', () => {
      const keys = Object.keys(PALETTES) as Palette[];
      const curr = this.themeManager.getPalette();
      const nextIdx = (keys.indexOf(curr) + 1) % keys.length;
      this.themeManager.setPalette(keys[nextIdx]);
    });

    // Sync Pairs modal
    document.getElementById('btnSyncPairs')?.addEventListener('click', () => {
      this.openSyncPairsModal();
    });

    // New Drive button
    document.getElementById('btnNewDrive')?.addEventListener('click', () => {
      this.openNewDriveModal();
    });

    // Sidebar Filters (All, Pinned, Encrypted, Trash)
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = (btn as HTMLElement).dataset.filter;
        this.activeFilter = filter === 'all' ? null : (filter || null);
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderBreadcrumbs();
        this.renderContent();
      });
    });

    // Account Dropdown toggle
    const btnAvatar = document.getElementById('btnAvatar');
    const accountDropdown = document.getElementById('accountDropdown');
    if (btnAvatar && accountDropdown) {
      btnAvatar.addEventListener('click', e => {
        e.stopPropagation();
        accountDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => {
        accountDropdown.classList.add('hidden');
      });
    }

    // Account Logout button
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      await this.api.logout();
      this.session = null;
      this.loginStep = 'credentials';
      this.renderLoginScreen();
    });

    // Account Settings
    document.getElementById('btnAccountSettings')?.addEventListener('click', () => {
      this.showModal('Zero-Knowledge Security', `
        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
          <p><strong>Argon2id Master Key:</strong> Derived on-device. No plaintext credentials or keys leave this device.</p>
          <p style="margin-top: 8px;"><strong>MTProto Session:</strong> Active with user ID <code>${this.session?.user_id || '1049281720'}</code>.</p>
          <p style="margin-top: 8px;"><strong>Local SQLite Cache:</strong> <code>cache.db</code> in Write-Ahead Logging (WAL) mode with FTS5 index.</p>
        </div>
      `, `<button class="btn-action primary" id="btnModalCancel">Done</button>`);
      document.getElementById('btnModalCancel')?.addEventListener('click', () => this.closeModal());
    });

    // Mobile tabs
    document.querySelectorAll('.mobile-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as MobileTab;
        if (!tab) return;
        document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tabFiles = document.getElementById('tabContentFiles');
        const tabCamera = document.getElementById('tabContentCamera');
        const tabTransfers = document.getElementById('tabContentTransfers');
        const tabSettings = document.getElementById('tabContentSettings');

        if (tabFiles) tabFiles.style.display = tab === 'files' ? 'block' : 'none';
        if (tabCamera) tabCamera.style.display = tab === 'camera' ? 'block' : 'none';
        if (tabTransfers) tabTransfers.style.display = tab === 'transfers' ? 'block' : 'none';
        if (tabSettings) tabSettings.style.display = tab === 'settings' ? 'block' : 'none';
      });
    });
  }

  private renderSearchResults(results: SearchResult[]) {
    const foldersSection = document.getElementById('foldersSection');
    const filesList = document.getElementById('filesList');
    const filesSectionLabel = document.getElementById('filesSectionLabel');

    if (foldersSection) foldersSection.style.display = 'none';
    if (filesSectionLabel) filesSectionLabel.textContent = `Search Results (${results.length} found)`;

    if (!filesList) return;
    if (results.length === 0) {
      filesList.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">No matches found for that query.</div>`;
      return;
    }

    filesList.innerHTML = results
      .map(
        r => `
        <div class="file-row" style="cursor: pointer;">
          <div class="file-icon-box ${r.kind === 'folder' ? 'file-type-binary' : 'file-type-sheet'}">
            ${r.kind === 'folder' ? '📁' : '📄'}
          </div>
          <div class="file-details">
            <span class="file-name">${escapeHtml(r.name)}</span>
            <span class="file-meta">${r.kind === 'folder' ? 'Folder' : formatBytes(r.size_bytes || 0)}</span>
          </div>
        </div>
      `
      )
      .join('');
  }
}

function getFileIconSvg(type: string): string {
  switch (type) {
    case 'video':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/></svg>`;
    case 'image':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
    case 'pdf':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'sheet':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9H8"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

document.addEventListener('DOMContentLoaded', () => {
  new ProtoFsApp();
});
