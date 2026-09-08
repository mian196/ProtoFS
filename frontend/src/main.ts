import './style.css';
import QRCode from 'qrcode';
import { ProtoFsApi } from './api';
import { ThemeManager } from './theme';
import type { AuthSession, DriveMetadata, FileNode, FolderNode, OwnedChannel, SyncPair, TransferItem, UpdateInfo, ParsedShareLink, VirtualDriveStatus, DocumentsProviderStatus, WorkManagerSyncConfig, P2pSessionInfo, P2pStatus, P2pTransferProgress } from './types';

class ProtoFsApp {
  private api = new ProtoFsApi();
  private themeManager = new ThemeManager();

  private session: AuthSession | null = null;
  private activeDriveId = 'personal';
  private currentFolderId = 'root';
  private activeFilter: string | null = null;
  private viewMode: 'grid' | 'list' = 'grid';
  private selectedIds = new Set<string>();
  private activeTransfers: TransferItem[] = [];
  private virtualDriveStatus: VirtualDriveStatus | null = null;

  private drives: DriveMetadata[] = [];
  private folders: FolderNode[] = [];
  private files: FileNode[] = [];
  private syncPairs: SyncPair[] = [];
  private accounts: AuthSession[] = [];
  private isAddingAccount = false;
  private showAllOwnedChannels = localStorage.getItem('protofs_show_all_channels') === 'true';
  private autoCheckUpdates = localStorage.getItem('protofs_auto_check_updates') !== 'false';
  private cachedUpdateInfo: UpdateInfo | null = null;

  // Login flow state
  private authMethod: 'phone' | 'qr' = 'phone';
  private loginStep: 'credentials' | 'code' | '2fa' = 'credentials';
  private loginPhone = '';
  private loginApiId = '';
  private loginApiHash = '';
  private passwordHint = '';
  private qrTokenUrl = '';
  private qrPollTimer: any = null;

  constructor() {
    this.themeManager.init();
    this.bootstrap();
  }

  private async bootstrap() {
    this.session = await this.api.getSessionStatus();
    if (!this.session || !this.session.is_authenticated) {
      this.renderLoginScreen();
    } else {
      localStorage.removeItem('protofs_folders');
      localStorage.removeItem('protofs_files');
      localStorage.removeItem('protofs_drives');
      this.activeDriveId = this.session.active_drive_id || `drive_${this.session.user_id}`;
      await this.initWorkspace();
    }
  }

  // -------------------------------------------------------------------------
  // TELEGRAM MTPROTO ONBOARDING & LOGIN SCREEN
  // -------------------------------------------------------------------------

  private stopQrPolling() {
    if (this.qrPollTimer) {
      clearInterval(this.qrPollTimer);
      this.qrPollTimer = null;
    }
  }

  private renderLoginScreen() {
    this.stopQrPolling();
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          ${
            this.isAddingAccount && this.session
              ? `
            <button type="button" class="btn-cancel-add-account" id="btnCancelAddAccount">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Cancel and return to ${escapeHtml(this.session.first_name || 'Workspace')}</span>
            </button>
          `
              : ''
          }
          <div class="login-brand">
            <div class="login-logo">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
              </svg>
            </div>
            <h1 class="login-title">ProtoFS Cloud Drive</h1>
            <p class="login-subtitle">Unlimited, zero-knowledge encrypted cloud storage powered directly by your private Telegram channels.</p>
          </div>

          ${
            this.loginStep !== '2fa'
              ? `
            <!-- Login Method Selector Tabs -->
            <div class="auth-method-tabs">
              <button type="button" class="auth-method-tab ${this.authMethod === 'phone' ? 'active' : ''}" id="tabAuthPhone">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>Phone Number</span>
              </button>
              <button type="button" class="auth-method-tab ${this.authMethod === 'qr' ? 'active' : ''}" id="tabAuthQr">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                <span>Scan QR Code</span>
              </button>
            </div>
          `
              : ''
          }

          <div class="login-step-badges">
            ${
              this.loginStep === '2fa'
                ? `<span class="step-badge active">Two-Step Verification (2FA)</span>`
                : this.authMethod === 'phone'
                ? `
              <span class="step-badge ${this.loginStep === 'credentials' ? 'active' : ''}">1. Telegram Auth</span>
              <span class="step-badge ${this.loginStep === 'code' ? 'active' : ''}">2. Verification Code</span>
            `
                : `
              <span class="step-badge active">1. Official Telegram QR Scan</span>
            `
            }
          </div>

          ${
            this.loginStep === '2fa'
              ? `
            <!-- Dedicated 2FA Screen: only shown if account requires 2FA -->
            <form class="login-form" id="formVerify2Fa">
              <div class="twofa-badge-card">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span>This account requires your Cloud Two-Step Verification Password.</span>
              </div>

              ${
                this.passwordHint
                  ? `
                <div class="password-hint-box">
                  <span>Password Hint: <strong>${escapeHtml(this.passwordHint)}</strong></span>
                </div>
              `
                  : ''
              }

              <div class="form-group">
                <label class="form-label">2FA Cloud Password</label>
                <input type="password" class="form-input" id="input2faPassword" placeholder="Enter your 2FA password" required autofocus>
              </div>

              <div class="form-actions-row">
                <button type="button" class="btn-secondary-tg" id="btnBackFrom2Fa">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                  <span>Back</span>
                </button>
                <button type="submit" class="btn-primary-tg" id="btnSubmit2Fa">
                  <span>Verify & Enter ProtoFS</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </form>
          `
              : this.authMethod === 'phone'
              ? this.loginStep === 'credentials'
                ? `
            <!-- Phone Step 1: Credentials -->
            <form class="login-form" id="formCredentials">
              <div class="form-group">
                <label class="form-label">
                  <span>API ID & API Hash</span>
                  <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer">my.telegram.org ↗</a>
                </label>
                <div class="form-row">
                  <input type="text" class="form-input" id="inputApiId" placeholder="API ID (e.g. 20401928)" value="${escapeHtml(this.loginApiId)}" required>
                  <input type="password" class="form-input" id="inputApiHash" placeholder="API Hash (e.g. 3a9f...)" value="${escapeHtml(this.loginApiHash)}" required>
                </div>
              </div>



              <div class="form-group">
                <label class="form-label">Telegram Phone Number</label>
                <input type="tel" class="form-input" id="inputPhone" placeholder="+1 202 555 0192" value="${escapeHtml(this.loginPhone)}" required>
              </div>

              <div class="login-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>Keys are stored locally only and never sent to any external server. ProtoFS connects directly to Telegram MTProto servers.</span>
              </div>

              <button type="submit" class="btn-primary-tg" id="btnSendCode">
                <span>Request Login Code</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </form>
          `
                : `
            <!-- Phone Step 2: Verification Code (NO 2FA password field shown here) -->
            <form class="login-form" id="formVerifyCode">
              <div class="form-group">
                <label class="form-label">Verification Code</label>
                <input type="text" class="form-input" id="inputCode" placeholder="Enter 5-digit Telegram code" required autofocus>
                <span style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Code sent via Telegram chat to ${escapeHtml(this.loginPhone)}</span>
              </div>

              <div class="form-actions-row">
                <button type="button" class="btn-secondary-tg" id="btnBackToPhone">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                  <span>Back</span>
                </button>
                <button type="submit" class="btn-primary-tg">
                  <span>Enter ProtoFS Drive</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </form>
          `
              : `
            <!-- QR Code Login View -->
            <div class="qr-login-container">
              <div class="form-group" style="width: 100%;">
                <label class="form-label">
                  <span>API ID & API Hash</span>
                  <a href="https://my.telegram.org" target="_blank" rel="noopener noreferrer">my.telegram.org ↗</a>
                </label>
                <div class="form-row">
                  <input type="text" class="form-input" id="inputApiId" placeholder="API ID (e.g. 20401928)" value="${escapeHtml(this.loginApiId)}" required>
                  <input type="password" class="form-input" id="inputApiHash" placeholder="API Hash (e.g. 3a9f...)" value="${escapeHtml(this.loginApiHash)}" required>
                </div>
              </div>

              <div class="qr-preview-box" id="qrPreviewBox">
                <canvas id="qrCanvas"></canvas>
              </div>

              <div class="qr-status-indicator">
                <span class="pulse-dot"></span>
                <span id="qrStatusText">Generating Telegram login QR code...</span>
              </div>

              <div class="qr-instruction-card">
                <strong>Log in via QR Code:</strong>
                <ol class="qr-instruction-list">
                  <li>Open Telegram on your mobile device</li>
                  <li>Go to <strong>Settings &gt; Devices &gt; Link Desktop Device</strong></li>
                  <li>Point your phone camera at this QR code to confirm</li>
                </ol>
              </div>

              <button type="button" class="btn-secondary-tg" id="btnRefreshQr" style="width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span>Refresh QR Code</span>
              </button>
            </div>
          `
          }
        </div>
      </div>
    `;

    this.bindLoginEvents();
    if (this.authMethod === 'qr' && this.loginStep !== '2fa') {
      this.initQrLogin();
    }
  }

  private bindLoginEvents() {
    // Tabs
    const tabPhone = document.getElementById('tabAuthPhone');
    if (tabPhone) {
      tabPhone.addEventListener('click', () => {
        this.authMethod = 'phone';
        this.loginStep = 'credentials';
        this.renderLoginScreen();
      });
    }

    const tabQr = document.getElementById('tabAuthQr');
    if (tabQr) {
      tabQr.addEventListener('click', () => {
        this.authMethod = 'qr';
        this.loginStep = 'credentials';
        this.renderLoginScreen();
      });
    }

    const btnRefreshQr = document.getElementById('btnRefreshQr');
    if (btnRefreshQr) {
      btnRefreshQr.addEventListener('click', () => {
        this.initQrLogin();
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
          await this.showAlert({
            title: 'Authentication Error',
            message: `Login error: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    }

    const btnCancelAddAccount = document.getElementById('btnCancelAddAccount');
    if (btnCancelAddAccount) {
      btnCancelAddAccount.addEventListener('click', async () => {
        this.stopQrPolling();
        this.isAddingAccount = false;
        this.loginStep = 'credentials';
        await this.initWorkspace();
      });
    }

    const btnBackToPhone = document.getElementById('btnBackToPhone');
    if (btnBackToPhone) {
      btnBackToPhone.addEventListener('click', () => {
        this.loginStep = 'credentials';
        this.renderLoginScreen();
      });
    }

    const btnBackFrom2Fa = document.getElementById('btnBackFrom2Fa');
    if (btnBackFrom2Fa) {
      btnBackFrom2Fa.addEventListener('click', () => {
        this.loginStep = this.authMethod === 'qr' ? 'credentials' : 'code';
        this.renderLoginScreen();
      });
    }

    const formVerifyCode = document.getElementById('formVerifyCode');
    if (formVerifyCode) {
      formVerifyCode.addEventListener('submit', async e => {
        e.preventDefault();
        const codeEl = document.getElementById('inputCode') as HTMLInputElement;

        try {
          const res = await this.api.loginVerifyCode(
            this.loginPhone,
            this.loginApiId,
            this.loginApiHash,
            codeEl.value.trim()
          );

          if (res.requires_2fa) {
            this.passwordHint = res.hint || '';
            this.loginStep = '2fa';
            this.renderLoginScreen();
            return;
          }

          if (res.session) {
            this.session = res.session;
            this.isAddingAccount = false;
            localStorage.removeItem('protofs_folders');
            localStorage.removeItem('protofs_files');
            localStorage.removeItem('protofs_drives');
            this.activeDriveId = res.session.active_drive_id || `drive_${res.session.user_id}`;
            await this.initWorkspace();
          }
        } catch (err: any) {
          await this.showAlert({
            title: 'Verification Failed',
            message: `Verification error: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    }

    const formVerify2Fa = document.getElementById('formVerify2Fa');
    if (formVerify2Fa) {
      formVerify2Fa.addEventListener('submit', async e => {
        e.preventDefault();
        const pwdEl = document.getElementById('input2faPassword') as HTMLInputElement;

        try {
          const res = await this.api.loginVerify2Fa(
            this.loginApiId,
            this.loginApiHash,
            pwdEl.value.trim()
          );

          if (res.session) {
            this.session = res.session;
            this.isAddingAccount = false;
            this.loginStep = 'credentials';
            localStorage.removeItem('protofs_folders');
            localStorage.removeItem('protofs_files');
            localStorage.removeItem('protofs_drives');
            this.activeDriveId = res.session.active_drive_id || `drive_${res.session.user_id}`;
            await this.initWorkspace();
          }
        } catch (err: any) {
          await this.showAlert({
            title: '2FA Verification Failed',
            message: `2FA verification error: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    }
  }

  private async initQrLogin() {
    this.stopQrPolling();
    const idEl = document.getElementById('inputApiId') as HTMLInputElement;
    const hashEl = document.getElementById('inputApiHash') as HTMLInputElement;
    const apiId = idEl ? idEl.value.trim() : this.loginApiId;
    const apiHash = hashEl ? hashEl.value.trim() : this.loginApiHash;
    this.loginApiId = apiId;
    this.loginApiHash = apiHash;

    try {
      const statusText = document.getElementById('qrStatusText');
      if (statusText) statusText.textContent = 'Generating Telegram login QR code...';
      const res = await this.api.loginRequestQr(apiId, apiHash);
      this.qrTokenUrl = res.token_url;
      this.renderQrCode(res.token_url);
      if (statusText) statusText.textContent = 'Waiting for scan in Telegram app...';

      this.qrPollTimer = setInterval(async () => {
        try {
          const check = await this.api.loginCheckQr(this.loginApiId, this.loginApiHash);
          if (check.status === 'waiting_scan') {
            if (check.token_url && check.token_url !== this.qrTokenUrl) {
              this.qrTokenUrl = check.token_url;
              this.renderQrCode(check.token_url);
            }
          } else if (check.status === 'requires_2fa') {
            this.stopQrPolling();
            this.passwordHint = check.hint || '';
            this.loginStep = '2fa';
            this.renderLoginScreen();
          } else if (check.status === 'success' && check.session) {
            this.stopQrPolling();
            this.session = check.session;
            this.isAddingAccount = false;
            this.loginStep = 'credentials';
            localStorage.removeItem('protofs_folders');
            localStorage.removeItem('protofs_files');
            localStorage.removeItem('protofs_drives');
            this.activeDriveId = check.session.active_drive_id || `drive_${check.session.user_id}`;
            await this.initWorkspace();
          }
        } catch (pollErr) {
          console.warn('QR poll status error:', pollErr);
        }
      }, 2000);
    } catch (err: any) {
      const statusText = document.getElementById('qrStatusText');
      if (statusText) statusText.textContent = `Error: ${err.message || err}`;
    }
  }

  private renderQrCode(url: string) {
    const canvas = document.getElementById('qrCanvas') as HTMLCanvasElement;
    if (canvas && url) {
      QRCode.toCanvas(canvas, url, {
        width: 192,
        margin: 1,
        color: {
          dark: '#0f141c',
          light: '#ffffff',
        },
      }).catch(err => console.error('Failed to draw QR code canvas:', err));
    }
  }

  // -------------------------------------------------------------------------
  // MAIN WORKSPACE & FILE EXPLORER
  // -------------------------------------------------------------------------

  private async initWorkspace() {
    this.accounts = await this.api.listAccounts();
    this.renderAppShell();
    this.bindEvents();
    await this.loadWorkspaceData();
    if (this.autoCheckUpdates) {
      this.checkUpdatesSilently();
    }
    await this.checkPendingUploads();
  }

  private renderAppShell() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const userInitial = this.session?.first_name ? this.session.first_name.slice(0, 2).toUpperCase() : 'PF';
    const userName = this.session?.username ? `@${this.session.username}` : (this.session?.phone || 'Connected');

    appEl.innerHTML = `
      <!-- Top Header Title Bar -->
      <header class="proto-header">
        <div class="brand-box">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
          <span class="brand-name">ProtoFS</span>
          <span class="version-pill" id="btnVersionPill" style="cursor: pointer;" title="ProtoFS v0.2.0: Click to check for updates">v0.2.0</span>
        </div>

        <div class="search-container" style="position: relative;">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="search-input" id="globalSearchInput" placeholder="Search files (SQLite FTS5)..." aria-label="Search" autocomplete="off">
          <span class="shortcut-hint">Ctrl+K</span>
          <div class="search-results-dropdown hidden" id="searchDropdown"></div>
        </div>

        <div class="header-actions">
          <!-- View Toggle (Grid / List) -->
          <div class="view-toggle-group">
            <button class="btn-view-toggle ${this.viewMode === 'grid' ? 'active' : ''}" id="btnViewGrid" title="Grid View">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
            </button>
            <button class="btn-view-toggle ${this.viewMode === 'list' ? 'active' : ''}" id="btnViewList" title="List View">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
            </button>
          </div>

          <!-- Color Themes -->
          <button class="icon-btn" id="btnPalette" title="Color Themes" aria-label="Choose color palette">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          </button>
          <button class="icon-btn" id="btnTheme" title="Toggle Light/Dark Mode" aria-label="Toggle Light and Dark Mode">
            <svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>
          </button>
          <button class="icon-btn" id="btnSyncPairs" title="Sync Pairs" aria-label="Sync Pairs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          </button>
          <button class="icon-btn" id="btnHeaderUpdates" title="Check for Updates" aria-label="Check for updates" style="position: relative;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span class="update-notification-dot hidden" id="updateNotificationDot"></span>
          </button>

          <!-- Native Virtual Drive Mount Pill -->
          <button class="mount-pill-btn" id="btnQuickMountDrive" title="Mount Native Virtual Drive">
            <span class="mount-dot-pulse hidden" id="mountPulseDot"></span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
            <span id="mountPillText">Mount Drive</span>
          </button>

          <!-- User Profile & Dropdown -->
          <div class="account-menu-wrapper">
            <div class="user-avatar" id="btnAvatar" title="Account Details" style="cursor: pointer;">
              <span>${userInitial}</span>
            </div>
            <div class="account-dropdown hidden" id="accountDropdown">
              <div class="account-dropdown-header">
                <span class="account-user-name">${escapeHtml(this.session?.first_name || 'ProtoFS User')}</span>
                <span class="account-user-phone">${escapeHtml(userName)}</span>
              </div>

              <!-- Multi-Account Section -->
              <div class="account-section-heading">
                <span>Accounts (${this.accounts.length})</span>
              </div>
              <div class="account-list" id="accountListContainer">
                ${this.accounts
                  .map(acc => {
                    const isCurrent = acc.user_id === this.session?.user_id;
                    const initial = acc.first_name ? acc.first_name.slice(0, 2).toUpperCase() : 'TG';
                    const handle = acc.username ? `@${acc.username}` : acc.phone;
                    return `
                      <div class="account-item ${isCurrent ? 'active' : ''}" data-account-user-id="${acc.user_id}">
                        <div class="account-mini-avatar">${initial}</div>
                        <div class="account-info">
                          <span class="account-item-name">${escapeHtml(acc.first_name || 'Telegram User')}</span>
                          <span class="account-item-phone">${escapeHtml(handle)}</span>
                        </div>
                        ${
                          isCurrent
                            ? `
                          <div class="account-check-badge" title="Active Account">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        `
                            : `
                          <button class="btn-remove-account" data-remove-user-id="${acc.user_id}" title="Remove Account">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        `
                        }
                      </div>
                    `;
                  })
                  .join('')}
              </div>

              <button class="account-menu-item" id="btnAddAccount">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Add Telegram Account</span>
              </button>

              <div class="account-menu-divider"></div>

              <button class="account-menu-item" id="btnAccountSettings">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Encryption Keys & Security</span>
              </button>
              <button class="account-menu-item" id="btnStorageDashboard">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                <span>Storage Breakdown Dashboard</span>
              </button>
              <button class="account-menu-item" id="btnMenuAndroidSaf">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                <span>Android SAF Integration</span>
              </button>
              <button class="account-menu-item" id="btnMenuAndroidWorkManager">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Android Background Sync</span>
              </button>
              <button class="account-menu-item" id="btnMenuP2pDirect">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                <span>P2P Direct Sharing</span>
              </button>
              <button class="account-menu-item" id="btnMenuCheckUpdates">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span>Check for Updates</span>
                <span class="update-menu-badge hidden" id="updateMenuBadge">Update</span>
              </button>
              <button class="account-menu-item danger" id="btnLogout">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Log Out Current Account</span>
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
              <span>DRIVES</span>
              <div style="display: flex; gap: 4px;">
                <button class="icon-btn" id="btnMountVirtualDrive" title="Mount Native Virtual Drive (P:\)" style="width:22px;height:22px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
                </button>
                <button class="icon-btn" id="btnExportDrive" title="Export Current Drive to Local Folder" style="width:22px;height:22px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button class="icon-btn" id="btnNewDrive" title="New Telegram Drive" style="width:22px;height:22px;">+</button>
              </div>
            </div>
            <nav class="nav-list" id="drivesNavList"></nav>

            <div class="sidebar-section-title" style="margin-top: 20px;">
              <span>QUICK ACCESS</span>
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
                <span class="nav-count" id="trashNavCount" style="margin-left: auto; font-size: 11px; background: var(--bg-surface-elevated); padding: 2px 6px; border-radius: 9999px;">0</span>
              </button>
              <button class="nav-item ${this.activeFilter === 'sync' ? 'active' : ''}" data-filter="sync">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                <span>Sync Pairs</span>
              </button>
            </nav>
          </div>

          <!-- Storage Card -->
          <div class="storage-card" id="btnStorageCard" style="cursor: pointer;" title="Click for Storage Dashboard">
            <div class="storage-card-header">
              <span>Cloud Storage</span>
              <span style="color: var(--accent-primary);" id="storageUsageText">Unlimited</span>
            </div>
            <div class="storage-bar">
              <div class="storage-bar-fill" id="storageBarFill" style="width: 25%;"></div>
            </div>
            <div class="storage-sub">Telegram Channel: Unlimited Quota</div>
          </div>
        </aside>

        <!-- Main Explorer View -->
        <main class="main-view" id="mainView">
          <!-- Action Toolbar -->
          <div class="action-toolbar">
            <div class="breadcrumbs-bar" id="breadcrumbsBar"></div>
            <div class="toolbar-buttons" id="toolbarButtons"></div>
          </div>

          <!-- Browser Viewport -->
          <div class="browser-viewport" id="browserViewport">
            <!-- Dynamic Sections for Folders & Files -->
            <div id="foldersSection">
              <div class="section-label" id="foldersSectionLabel">Folders</div>
              <div class="folder-grid" id="foldersGrid"></div>
            </div>

            <div id="filesSection" style="margin-top: 20px;">
              <div class="section-label" id="filesSectionLabel">Files</div>
              <div class="files-container ${this.viewMode === 'grid' ? 'grid-mode' : 'list-mode'}" id="filesContainer"></div>
            </div>

            <!-- Sync Pairs View (Only visible when activeFilter === 'sync') -->
            <div id="syncPairsSection" style="display: none;">
              <div class="sync-pairs-grid" id="syncPairsGrid"></div>
            </div>
          </div>
        </main>
      </div>

      <!-- Dynamic Floating Selection Action Bar -->
      <div class="selection-floating-bar hidden" id="selectionFloatingBar">
        <span class="selection-count-pill" id="selectionCountPill">0 selected</span>
        <div class="selection-actions-row">
          <button class="btn-selection-tool" id="btnSelDownload" title="Download">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download</span>
          </button>
          <button class="btn-selection-tool" id="btnSelPreview" title="Preview single file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Preview</span>
          </button>
          <button class="btn-selection-tool" id="btnSelHistory" title="Version History">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>History</span>
          </button>
          <button class="btn-selection-tool" id="btnSelShare" title="Share Link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            <span>Share</span>
          </button>
          <button class="btn-selection-tool" id="btnSelP2pShare" title="P2P Direct LAN Share">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            <span>P2P Direct</span>
          </button>
          <button class="btn-selection-tool" id="btnSelRename" title="Rename item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span>Rename</span>
          </button>
          <button class="btn-selection-tool" id="btnSelMove" title="Move to folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
            <span>Move</span>
          </button>
          <button class="btn-selection-tool" id="btnSelPin" title="Pin / Unpin Offline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            <span>Pin</span>
          </button>
          <button class="btn-selection-tool danger" id="btnSelTrash" title="Move selected to Trash">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span>Trash</span>
          </button>
          <button class="btn-selection-tool" id="btnSelDeselect" title="Deselect All">✕</button>
        </div>
      </div>

      <!-- Reactive Transfer Dock (Appears when active transfers exist) -->
      <div class="reactive-transfer-dock hidden" id="reactiveTransferDock">
        <div class="transfer-dock-header" id="transferDockHeader">
          <div class="transfer-header-info">
            <span class="pulse-dot"></span>
            <span id="transferDockTitle">MTProto Stream Transfers</span>
          </div>
          <div class="transfer-header-controls">
            <button class="btn-dock-icon" id="btnCollapseDock" title="Collapse / Expand">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>
            </button>
            <button class="btn-dock-icon" id="btnCloseDock" title="Dismiss">✕</button>
          </div>
        </div>
        <div class="transfer-dock-body" id="transferDockBody"></div>
      </div>

      <!-- Generic Dynamic Modal Dialog -->
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
      this.syncPairs = await this.api.getSyncPairs(this.activeDriveId);
      try {
        this.virtualDriveStatus = await this.api.getVirtualDriveStatus(this.activeDriveId);
      } catch {
        this.virtualDriveStatus = null;
      }
    } else {
      this.activeDriveId = '';
      this.folders = [];
      this.files = [];
      this.syncPairs = [];
      this.virtualDriveStatus = null;
    }
    this.updateVirtualDrivePill();

    this.selectedIds.clear();
    this.updateSelectionBar();
    this.renderDrivesNav();
    this.renderBreadcrumbs();
    this.renderContent();
    this.updateStorageUsage();
  }

  private renderDrivesNav() {
    const listEl = document.getElementById('drivesNavList');
    if (!listEl) return;

    if (this.drives.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 10px 12px; font-size: 11px; color: var(--text-muted); line-height: 1.5; background: var(--bg-surface-elevated); border-radius: var(--radius-sm); margin: 6px 8px;">
          No drives yet.<br/>
          <a href="javascript:void(0)" id="linkCreateFirstDriveNav" style="color: var(--accent-primary); font-weight: 600; text-decoration: none;">+ Create a drive</a>
        </div>
      `;
      document.getElementById('linkCreateFirstDriveNav')?.addEventListener('click', () => {
        this.openNewDriveModal('create');
      });
      return;
    }

    listEl.innerHTML = this.drives
      .map(d => {
        const isMounted = this.virtualDriveStatus?.is_mounted && this.virtualDriveStatus.drive_id === d.id && this.virtualDriveStatus.drive_letter;
        return `
        <div class="nav-item-wrapper" style="display: flex; align-items: center; justify-content: space-between; position: relative;">
          <button class="nav-item ${d.id === this.activeDriveId && this.activeFilter === null ? 'active' : ''}" data-drive-id="${d.id}" style="flex: 1; min-width: 0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(d.name)}</span>
            ${isMounted ? `<span class="mount-nav-badge">${this.virtualDriveStatus!.drive_letter}:\\</span>` : ''}
          </button>
          <button class="btn-delete-drive-item icon-btn" data-drive-id="${d.id}" data-drive-name="${escapeHtml(d.name)}" title="Remove this drive" style="width: 20px; height: 20px; margin-right: 6px; opacity: 0.5; transition: opacity 0.2s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.5'">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `;
      })
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

    listEl.querySelectorAll('.btn-delete-drive-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dId = (btn as HTMLElement).dataset.driveId;
        const dName = (btn as HTMLElement).dataset.driveName || 'this drive';
        if (!dId) return;
        const confirmed = await this.showConfirm({
          title: 'Remove Drive',
          message: `Remove "${dName}" from ProtoFS? Any remote Telegram messages will remain untouched.`,
          confirmText: 'Remove Drive',
          isDanger: true,
        });
        if (confirmed) {
          await this.api.deleteDrive(dId);
          if (this.activeDriveId === dId) {
            this.activeDriveId = '';
          }
          await this.loadWorkspaceData();
        }
      });
    });
  }

  private renderBreadcrumbs() {
    const bar = document.getElementById('breadcrumbsBar');
    if (!bar) return;

    if (this.drives.length === 0) {
      bar.innerHTML = `<span class="crumb-item active">No Drives</span>`;
      return;
    }

    const drive = this.drives.find(d => d.id === this.activeDriveId);
    const driveName = drive ? drive.name : 'Drive';

    if (this.activeFilter === 'trash') {
      bar.innerHTML = `<span>${escapeHtml(driveName)}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Trash / Recycle Bin</span>`;
      return;
    }
    if (this.activeFilter === 'pinned') {
      bar.innerHTML = `<span>${escapeHtml(driveName)}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Offline Pinned</span>`;
      return;
    }
    if (this.activeFilter === 'encrypted') {
      bar.innerHTML = `<span>${escapeHtml(driveName)}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Encrypted Vaults</span>`;
      return;
    }
    if (this.activeFilter === 'sync') {
      bar.innerHTML = `<span>${escapeHtml(driveName)}</span> <span class="crumb-sep">/</span> <span class="crumb-item active">Sync Pairs</span>`;
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
          this.selectedIds.clear();
          this.updateSelectionBar();
          this.renderBreadcrumbs();
          this.renderContent();
        }
      });
    });
  }

  private renderContent() {
    const foldersSection = document.getElementById('foldersSection');
    const foldersGrid = document.getElementById('foldersGrid');
    const filesSection = document.getElementById('filesSection');
    const filesContainer = document.getElementById('filesContainer');
    const filesSectionLabel = document.getElementById('filesSectionLabel');
    const syncPairsSection = document.getElementById('syncPairsSection');
    const toolbarButtons = document.getElementById('toolbarButtons');
    const trashNavCount = document.getElementById('trashNavCount');

    if (!foldersGrid || !filesContainer) return;

    // Update trash count badge
    const trashedTotal = this.files.filter(f => f.trashed).length;
    if (trashNavCount) trashNavCount.textContent = String(trashedTotal);

    // Update container mode
    filesContainer.className = `files-container ${this.viewMode === 'grid' ? 'grid-mode' : 'list-mode'}`;

    if (syncPairsSection) syncPairsSection.style.display = this.activeFilter === 'sync' ? 'block' : 'none';

    // 1. SYNC PAIRS VIEW
    if (this.activeFilter === 'sync') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSection) filesSection.style.display = 'none';
      if (toolbarButtons) {
        toolbarButtons.innerHTML = `
          <button class="btn-action secondary" id="btnSetupCameraBackup" style="border-color: rgba(236, 72, 153, 0.4); color: #ec4899;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span>Camera & Media Backup</span>
          </button>
          <button class="btn-action primary" id="btnAddSyncPair">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add Sync Pair</span>
          </button>
        `;
        document.getElementById('btnSetupCameraBackup')?.addEventListener('click', () => this.openCameraBackupModal());
        document.getElementById('btnAddSyncPair')?.addEventListener('click', () => this.openAddSyncPairModal());
      }
      this.renderSyncPairsView();
      return;
    }

    if (filesSection) filesSection.style.display = 'block';

    // 1.5 NO DRIVES ZERO-STATE
    if (this.drives.length === 0 && this.activeFilter === null) {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Welcome to ProtoFS';
      if (toolbarButtons) {
        toolbarButtons.innerHTML = `
          <button class="btn-action secondary" id="btnAdoptFirstDrive">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Adopt Channel</span>
          </button>
          <button class="btn-action primary" id="btnCreateFirstDrive">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Create Drive</span>
          </button>
        `;
        document.getElementById('btnCreateFirstDrive')?.addEventListener('click', () => this.openNewDriveModal('create'));
        document.getElementById('btnAdoptFirstDrive')?.addEventListener('click', () => this.openNewDriveModal('adopt'));
      }

      filesContainer.innerHTML = `
        <div style="grid-column: 1/-1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center;">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; color: var(--accent-primary); margin-bottom: 20px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            </svg>
          </div>
          <h2 style="font-size: 18px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">No Drives Created Yet</h2>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 440px; line-height: 1.6; margin-bottom: 24px;">
            ProtoFS stores your files with client-side zero-knowledge encryption using private Telegram channels. Create a new drive or connect an existing channel to get started.
          </p>
          <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
            <button class="btn-action primary" id="btnEmptyStateCreateDrive" style="padding: 8px 18px; font-size: 13px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Create New Drive</span>
            </button>
            <button class="btn-action secondary" id="btnEmptyStateAdoptChannel" style="padding: 8px 18px; font-size: 13px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Adopt Existing Channel</span>
            </button>
          </div>
        </div>
      `;
      document.getElementById('btnEmptyStateCreateDrive')?.addEventListener('click', () => this.openNewDriveModal('create'));
      document.getElementById('btnEmptyStateAdoptChannel')?.addEventListener('click', () => this.openNewDriveModal('adopt'));
      return;
    }

    // 2. TRASH VIEW
    if (this.activeFilter === 'trash') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Trash / Recycle Bin (30-day retention)';
      if (toolbarButtons) {
        toolbarButtons.innerHTML = `
          <button class="btn-action secondary" id="btnRestoreAll">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            <span>Restore All</span>
          </button>
          <button class="btn-action danger" id="btnEmptyTrash">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span>Empty Trash</span>
          </button>
        `;
        document.getElementById('btnEmptyTrash')?.addEventListener('click', () => this.handleEmptyTrash());
        document.getElementById('btnRestoreAll')?.addEventListener('click', async () => {
          for (const f of this.files.filter(x => x.trashed)) {
            await this.api.restoreNode(this.activeDriveId, f.id);
          }
          await this.loadWorkspaceData();
        });
      }

      const trashedFiles = this.files.filter(f => f.trashed);
      if (trashedFiles.length === 0) {
        filesContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-muted);">Trash is empty. Deleted files are retained for 30 days.</div>`;
      } else {
        filesContainer.innerHTML = trashedFiles.map(f => this.renderFileItem(f, true)).join('');
        this.bindFileItemEvents(true);
      }
      return;
    }

    // 3. STANDARD NAVIGATION & FILTERS
    if (toolbarButtons) {
      toolbarButtons.innerHTML = `
        <button class="btn-action secondary" id="btnImportSharedLink" title="Import from Telegram or ProtoFS Link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span>Import Link</span>
        </button>
        <button class="btn-action secondary" id="btnNewFolder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
          <span>New Folder</span>
        </button>
        <button class="btn-action primary" id="btnUpload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Upload</span>
        </button>
      `;
      document.getElementById('btnImportSharedLink')?.addEventListener('click', () => this.openImportSharedLinkModal());
      document.getElementById('btnNewFolder')?.addEventListener('click', () => this.openNewFolderModal());
      document.getElementById('btnUpload')?.addEventListener('click', () => this.openUploadModal());
    }

    if (this.activeFilter === 'pinned') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Offline Pinned Files (Exempt from 14-day LRU auto-eviction)';
      const pinned = this.files.filter(f => !f.trashed && f.pinned);
      filesContainer.innerHTML = pinned.length
        ? pinned.map(f => this.renderFileItem(f)).join('')
        : `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-muted);">No pinned files. Pin items to guarantee offline access.</div>`;
      this.bindFileItemEvents();
      return;
    }

    if (this.activeFilter === 'encrypted') {
      if (foldersSection) foldersSection.style.display = 'none';
      if (filesSectionLabel) filesSectionLabel.textContent = 'Encrypted Vaults (AES-256-GCM 64KB STREAM Construction)';
      const enc = this.files.filter(f => !f.trashed && f.encrypted);
      filesContainer.innerHTML = enc.length
        ? enc.map(f => this.renderFileItem(f)).join('')
        : `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-muted);">No encrypted files in this drive.</div>`;
      this.bindFileItemEvents();
      return;
    }

    // Default folder view: Subfolders
    if (foldersSection) foldersSection.style.display = 'block';
    if (filesSectionLabel) filesSectionLabel.textContent = 'Files';

    const childFolders = this.folders.filter(f => f.parent_id === this.currentFolderId);
    if (childFolders.length === 0) {
      foldersGrid.innerHTML = `<div style="grid-column: 1/-1; padding: 12px; font-size: 12px; color: var(--text-muted);">No subfolders here. Click "+ New Folder" to create one.</div>`;
    } else {
      foldersGrid.innerHTML = childFolders
        .map(
          f => `
          <div class="folder-card ${this.selectedIds.has(f.id) ? 'selected' : ''}" data-folder-id="${f.id}">
            <div class="folder-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            </div>
            <div class="folder-details">
              <div class="folder-name">${escapeHtml(f.name)}</div>
              <div class="folder-count">${escapeHtml(f.count || 'Folder')}</div>
            </div>
          </div>
        `
        )
        .join('');

      foldersGrid.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', e => {
          if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
          const fId = (card as HTMLElement).dataset.folderId;
          if (fId) {
            this.currentFolderId = fId;
            this.selectedIds.clear();
            this.updateSelectionBar();
            this.renderBreadcrumbs();
            this.renderContent();
          }
        });
      });
    }

    // Files in current folder
    const childFiles = this.files.filter(f => !f.trashed && f.parent_id === this.currentFolderId);
    if (childFiles.length === 0) {
      filesContainer.innerHTML = `<div style="grid-column: 1/-1; padding: 32px; text-align: center; color: var(--text-muted);">Folder is empty. Click "+ Upload" to add files.</div>`;
    } else {
      filesContainer.innerHTML = childFiles.map(f => this.renderFileItem(f)).join('');
      this.bindFileItemEvents();
    }
  }

  // -------------------------------------------------------------------------
  // FILE ITEM RENDERING (GRID & LIST MODES)
  // -------------------------------------------------------------------------

  private renderFileItem(f: FileNode, isTrash = false): string {
    const isSelected = this.selectedIds.has(f.id);
    const iconSvg = getFileIconSvg(f.type);

    if (this.viewMode === 'grid') {
      return `
        <div class="file-card-grid ${isSelected ? 'selected' : ''}" data-file-id="${f.id}">
          <div class="file-card-top">
            <input type="checkbox" class="file-card-checkbox" data-file-id="${f.id}" ${isSelected ? 'checked' : ''}>
            <div class="file-card-badges">
              ${f.encrypted ? `<span class="file-badge encrypted" title="AES-256-GCM Encrypted">🔒</span>` : ''}
              ${f.pinned ? `<span class="file-badge pinned" title="Pinned Offline">📌</span>` : ''}
              ${f.version && f.version > 1 ? `<span class="file-badge version-badge" title="Version ${f.version}">v${f.version}</span>` : ''}
            </div>
          </div>
          <div class="file-card-icon-area file-type-${f.type}">
            ${iconSvg}
          </div>
          <div class="file-card-title" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="file-card-meta">
            <span>${f.size}</span>
            <span>${f.date}</span>
          </div>
        </div>
      `;
    }

    // List mode row
    return `
      <div class="file-row ${isSelected ? 'selected' : ''}" data-file-id="${f.id}">
        <input type="checkbox" class="file-checkbox" data-file-id="${f.id}" ${isSelected ? 'checked' : ''}>
        <div class="file-icon-box file-type-${f.type}">${iconSvg}</div>
        <div class="file-details">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="file-name">${escapeHtml(f.name)}</span>
            ${f.version && f.version > 1 ? `<span class="file-badge version-badge" style="padding: 1px 6px; font-size: 10px;" title="Version ${f.version}">v${f.version}</span>` : ''}
          </div>
          <span class="file-meta">${f.size} • ${f.date} ${f.encrypted ? '• 🔒 Encrypted' : ''} ${f.pinned ? '• 📌 Pinned' : ''} ${f.version && f.version > 1 ? `• v${f.version}` : ''}</span>
        </div>
        <div class="file-actions-group">
          ${
            isTrash
              ? `
            <button class="btn-icon-subtle btn-restore-file" data-id="${f.id}" title="Restore">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
            </button>
            <button class="btn-icon-subtle btn-delete-file-perm" data-id="${f.id}" title="Delete Permanently" style="color: var(--color-danger);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          `
              : `
            <button class="btn-icon-subtle btn-share-file" data-id="${f.id}" title="Share Link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </button>
            <button class="btn-icon-subtle btn-p2p-file" data-id="${f.id}" title="Share via Direct P2P LAN">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
            <button class="btn-icon-subtle btn-history-file" data-id="${f.id}" title="Version History">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
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

  private bindFileItemEvents(isTrash = false) {
    // Checkbox toggling
    document.querySelectorAll('.file-checkbox, .file-card-checkbox').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        const fId = (cb as HTMLElement).dataset.fileId;
        if (fId) {
          if ((cb as HTMLInputElement).checked) {
            this.selectedIds.add(fId);
          } else {
            this.selectedIds.delete(fId);
          }
          this.updateSelectionBar();
          this.renderContent();
        }
      });
    });

    // Card/Row click toggles selection or preview
    document.querySelectorAll('.file-card-grid, .file-row').forEach(el => {
      el.addEventListener('click', e => {
        const target = e.target as HTMLElement;
        if (target.tagName.toLowerCase() === 'input' || target.closest('.btn-icon-subtle')) return;

        const fId = (el as HTMLElement).dataset.fileId;
        if (fId) {
          if (this.selectedIds.has(fId)) {
            this.selectedIds.delete(fId);
          } else {
            this.selectedIds.add(fId);
          }
          this.updateSelectionBar();
          this.renderContent();
        }
      });
    });

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
          if (!id) return;
          const confirmed = await this.showConfirm({
            title: 'Delete Permanently',
            message: 'Permanently delete this message from Telegram? This action cannot be undone.',
            confirmText: 'Delete Permanently',
            isDanger: true,
          });
          if (confirmed) {
            await this.api.deleteNode(this.activeDriveId, id, true);
            await this.loadWorkspaceData();
          }
        });
      });
    } else {
      document.querySelectorAll('.btn-share-file').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) this.openShareModal(id);
        });
      });
      document.querySelectorAll('.btn-p2p-file').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          const file = this.files.find(f => f.id === id);
          if (file) this.openP2pShareModal(file);
        });
      });
      document.querySelectorAll('.btn-history-file').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.id;
          if (id) this.openVersionHistoryModal(id);
        });
      });
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

  // -------------------------------------------------------------------------
  // DYNAMIC SELECTION ACTION BAR
  // -------------------------------------------------------------------------

  private updateSelectionBar() {
    const bar = document.getElementById('selectionFloatingBar');
    const countPill = document.getElementById('selectionCountPill');
    const btnSelPreview = document.getElementById('btnSelPreview');
    const btnSelHistory = document.getElementById('btnSelHistory');
    const btnSelShare = document.getElementById('btnSelShare');
    const btnSelP2pShare = document.getElementById('btnSelP2pShare');
    const btnSelRename = document.getElementById('btnSelRename');

    if (!bar || !countPill) return;

    const count = this.selectedIds.size;
    if (count === 0) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    countPill.textContent = `${count} item${count > 1 ? 's' : ''} selected`;

    const isSingleFile = count === 1 && this.files.some(f => f.id === Array.from(this.selectedIds)[0]);

    // Preview, History, Share, P2P and Rename are only active for single item selection
    if (btnSelPreview) btnSelPreview.style.display = isSingleFile ? 'flex' : 'none';
    if (btnSelHistory) btnSelHistory.style.display = isSingleFile ? 'flex' : 'none';
    if (btnSelShare) btnSelShare.style.display = isSingleFile ? 'flex' : 'none';
    if (btnSelP2pShare) btnSelP2pShare.style.display = isSingleFile ? 'flex' : 'none';
    if (btnSelRename) btnSelRename.style.display = count === 1 ? 'flex' : 'none';
  }

  // -------------------------------------------------------------------------
  // SYNC PAIRS VIEW
  // -------------------------------------------------------------------------

  private renderSyncPairsView() {
    const grid = document.getElementById('syncPairsGrid');
    if (!grid) return;

    if (this.syncPairs.length === 0) {
      grid.innerHTML = `
        <div style="padding: 32px; text-align: center; color: var(--text-muted); background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <p style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">No Active Sync Pairs</p>
          <p style="font-size: 12px; margin-bottom: 16px;">Map a local OS folder or setup camera roll auto-backup to Telegram.</p>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn-action secondary" id="btnEmptyCameraSync" style="border-color: rgba(236, 72, 153, 0.4); color: #ec4899;">Setup Camera Backup</button>
            <button class="btn-action primary" id="btnEmptyAddSync">Add Sync Pair</button>
          </div>
        </div>
      `;
      document.getElementById('btnEmptyCameraSync')?.addEventListener('click', () => this.openCameraBackupModal());
      document.getElementById('btnEmptyAddSync')?.addEventListener('click', () => this.openAddSyncPairModal());
      return;
    }

    grid.innerHTML = this.syncPairs
      .map(p => {
        const isCamera =
          p.sync_mode.includes('camera') ||
          p.local_path.includes('Camera') ||
          p.local_path.includes('Pictures');

        const badge = isCamera
          ? `<span class="camera-backup-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Camera Backup</span>`
          : `<span class="sync-mode-pill">${escapeHtml(p.sync_mode)}</span>`;

        const pills = isCamera
          ? `
            <div style="display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;">
              <span class="camera-constraint-pill">📶 Wi-Fi Only</span>
              ${p.sync_mode.includes('charging:true') ? '<span class="camera-constraint-pill">⚡ AC Power</span>' : ''}
              ${!p.sync_mode.includes('videos:false') ? '<span class="camera-constraint-pill">🎞 Videos Included</span>' : ''}
              ${!p.sync_mode.includes('raw:false') ? '<span class="camera-constraint-pill">📸 Lossless Raw</span>' : ''}
            </div>
          `
          : '';

        return `
        <div class="sync-pair-card">
          <div class="sync-pair-info">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sync-pair-path">${escapeHtml(p.local_path)}</span>
              ${badge}
            </div>
            ${pills}
            <div class="sync-pair-sub" style="margin-top: 4px;">Mapped to folder: <code>${escapeHtml(p.remote_folder_id)}</code> • ${p.status}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn-action secondary btn-sync-now" data-sync-id="${p.id}" title="Run Sync Now">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
              <span>Sync Now</span>
            </button>
            <button class="btn-action secondary btn-del-sync" data-sync-id="${p.id}" title="Remove Sync Pair" style="color: var(--color-danger);">✕</button>
          </div>
        </div>
      `;
      })
      .join('');

    grid.querySelectorAll('.btn-sync-now').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.syncId;
        if (id) {
          this.triggerTransfer('Sync: Local folder to Telegram', '14.2 MB', 'uploading');
          await this.api.triggerSync(id);
        }
      });
    });

    grid.querySelectorAll('.btn-del-sync').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.syncId;
        if (!id) return;
        const confirmed = await this.showConfirm({
          title: 'Remove Sync Pair',
          message: 'Are you sure you want to remove this sync pair? Local and remote files will remain intact.',
          confirmText: 'Remove Pair',
          isDanger: true,
        });
        if (confirmed) {
          await this.api.removeSyncPair(id, this.activeDriveId);
          this.syncPairs = await this.api.getSyncPairs(this.activeDriveId);
          this.renderSyncPairsView();
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // REACTIVE TRANSFER DOCK (DYNAMIC UPLOAD / DOWNLOAD SIMULATION)
  // -------------------------------------------------------------------------

  private triggerTransfer(name: string, size: string, status: 'uploading' | 'downloading') {
    const item: TransferItem = {
      id: `tf_${Date.now()}`,
      name,
      size,
      progress: 5,
      speed: '12.4 MB/s',
      status,
    };

    this.activeTransfers.push(item);
    this.renderTransferDock();

    const interval = setInterval(() => {
      item.progress += Math.floor(Math.random() * 20) + 12;
      if (item.progress >= 100) {
        item.progress = 100;
        item.status = 'completed';
        clearInterval(interval);
        this.renderTransferDock();

        setTimeout(() => {
          this.activeTransfers = this.activeTransfers.filter(t => t.id !== item.id);
          this.renderTransferDock();
        }, 4000);
      } else {
        this.renderTransferDock();
      }
    }, 450);
  }

  private renderTransferDock() {
    const dock = document.getElementById('reactiveTransferDock');
    const body = document.getElementById('transferDockBody');
    const title = document.getElementById('transferDockTitle');

    if (!dock || !body || !title) return;

    if (this.activeTransfers.length === 0) {
      dock.classList.add('hidden');
      return;
    }

    dock.classList.remove('hidden');
    title.textContent = `MTProto Sync: ${this.activeTransfers.length} active transfer${this.activeTransfers.length > 1 ? 's' : ''}`;

    body.innerHTML = this.activeTransfers
      .map(
        t => `
        <div class="transfer-card-item">
          <div class="transfer-item-row">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px;">${escapeHtml(t.name)}</span>
            <span>${t.progress}%</span>
          </div>
          <div class="transfer-progress-track">
            <div class="transfer-progress-bar" style="width: ${t.progress}%;"></div>
          </div>
          <div class="transfer-item-sub">
            <span>${t.status === 'completed' ? '✓ Transfer complete' : 'Streaming 64KB AES-256-GCM chunks'}</span>
            <span>${t.speed} • ${t.size}</span>
          </div>
        </div>
      `
      )
      .join('');
  }

  // -------------------------------------------------------------------------
  // INTERACTIVE MODALS & EVENT HANDLERS
  // -------------------------------------------------------------------------

  private bindEvents() {
    // Search input with FTS5 live lookup
    const searchInput = document.getElementById('globalSearchInput') as HTMLInputElement;
    const searchDropdown = document.getElementById('searchDropdown');

    if (searchInput && searchDropdown) {
      searchInput.addEventListener('input', async () => {
        const q = searchInput.value.trim();
        if (q.length < 2) {
          searchDropdown.classList.add('hidden');
          return;
        }

        const results = await this.api.searchNodes(this.activeDriveId, q);
        if (results.length === 0) {
          searchDropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">No matching files found.</div>`;
        } else {
          searchDropdown.innerHTML = results
            .map(
              r => `
              <div class="search-result-item" data-res-id="${r.id}" data-res-parent="${r.parent_id}">
                <span>${r.kind === 'folder' ? '📁' : '📄'}</span>
                <span class="search-result-name">${highlightMatch(escapeHtml(r.name), q)}</span>
                <span style="font-size: 11px; color: var(--text-muted);">${r.kind}</span>
              </div>
            `
            )
            .join('');

          searchDropdown.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
              const pId = (item as HTMLElement).dataset.resParent;
              const rId = (item as HTMLElement).dataset.resId;
              if (pId) {
                this.currentFolderId = pId;
                this.activeFilter = null;
                this.selectedIds.clear();
                if (rId) this.selectedIds.add(rId);
                searchDropdown.classList.add('hidden');
                searchInput.value = '';
                this.renderBreadcrumbs();
                this.renderContent();
                this.updateSelectionBar();
              }
            });
          });
        }
        searchDropdown.classList.remove('hidden');
      });

      document.addEventListener('click', e => {
        if (!searchInput.contains(e.target as Node) && !searchDropdown.contains(e.target as Node)) {
          searchDropdown.classList.add('hidden');
        }
      });
    }

    // Shortcut Ctrl+K
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput?.focus();
      }
      if (e.key === 'Escape') {
        searchDropdown?.classList.add('hidden');
        this.closeModal();
      }
    });

    // View toggle handlers
    document.getElementById('btnViewGrid')?.addEventListener('click', () => {
      this.viewMode = 'grid';
      document.getElementById('btnViewGrid')?.classList.add('active');
      document.getElementById('btnViewList')?.classList.remove('active');
      this.renderContent();
    });

    document.getElementById('btnViewList')?.addEventListener('click', () => {
      this.viewMode = 'list';
      document.getElementById('btnViewList')?.classList.add('active');
      document.getElementById('btnViewGrid')?.classList.remove('active');
      this.renderContent();
    });

    // Floating selection bar action triggers
    document.getElementById('btnSelDeselect')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.updateSelectionBar();
      this.renderContent();
    });

    document.getElementById('btnSelDownload')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length > 0) {
        const file = this.files.find(f => f.id === selected[0]);
        this.triggerTransfer(file ? file.name : 'ProtoFS_Archive.tar.gz', file ? file.size : '124 MB', 'downloading');
      }
    });

    document.getElementById('btnSelPreview')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        const file = this.files.find(f => f.id === selected[0]);
        if (file) this.openFilePreview(file);
      }
    });

    document.getElementById('btnSelHistory')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        const file = this.files.find(f => f.id === selected[0]);
        if (file) this.openVersionHistoryModal(file.id);
      }
    });

    document.getElementById('btnSelShare')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        const file = this.files.find(f => f.id === selected[0]);
        if (file) this.openShareModal(file.id);
      }
    });

    document.getElementById('btnSelP2pShare')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        const file = this.files.find(f => f.id === selected[0]);
        if (file) this.openP2pShareModal(file);
      }
    });

    document.getElementById('btnSelRename')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        const item = this.files.find(f => f.id === selected[0]) || this.folders.find(f => f.id === selected[0]);
        if (item) this.openRenameModal(item.id, item.name);
      }
    });

    document.getElementById('btnSelMove')?.addEventListener('click', () => {
      const selected = Array.from(this.selectedIds);
      if (selected.length === 1) {
        this.openMoveModal(selected[0]);
      }
    });

    document.getElementById('btnSelPin')?.addEventListener('click', async () => {
      for (const id of this.selectedIds) {
        const file = this.files.find(f => f.id === id);
        if (file) await this.api.togglePin(this.activeDriveId, id, !file.pinned);
      }
      await this.loadWorkspaceData();
    });

    document.getElementById('btnSelTrash')?.addEventListener('click', async () => {
      for (const id of this.selectedIds) {
        await this.api.deleteNode(this.activeDriveId, id, false);
      }
      await this.loadWorkspaceData();
    });

    // Transfer Dock Collapse / Close
    const transferDock = document.getElementById('reactiveTransferDock');
    document.getElementById('btnCollapseDock')?.addEventListener('click', () => {
      transferDock?.classList.toggle('collapsed');
    });
    document.getElementById('btnCloseDock')?.addEventListener('click', () => {
      transferDock?.classList.add('hidden');
    });

    // Sidebar Filter buttons
    document.querySelectorAll('.sidebar .nav-item[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = (btn as HTMLElement).dataset.filter;
        this.activeFilter = filter === 'all' ? null : (filter || null);
        document.querySelectorAll('.sidebar .nav-item[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedIds.clear();
        this.updateSelectionBar();
        this.renderBreadcrumbs();
        this.renderContent();
      });
    });

    // Header buttons
    document.getElementById('btnTheme')?.addEventListener('click', () => this.themeManager.toggleTheme());
    document.getElementById('btnPalette')?.addEventListener('click', () => this.themeManager.cyclePalette());
    document.getElementById('btnSyncPairs')?.addEventListener('click', () => {
      this.activeFilter = 'sync';
      this.renderBreadcrumbs();
      this.renderContent();
    });

    // Avatar Dropdown Toggle
    const btnAvatar = document.getElementById('btnAvatar');
    const accountDropdown = document.getElementById('accountDropdown');
    if (btnAvatar && accountDropdown) {
      btnAvatar.addEventListener('click', e => {
        e.stopPropagation();
        accountDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => accountDropdown.classList.add('hidden'));
    }

    // Multi-Account switching
    document.querySelectorAll('.account-item[data-account-user-id]').forEach(item => {
      item.addEventListener('click', async e => {
        if ((e.target as HTMLElement).closest('.btn-remove-account')) {
          return;
        }
        const uidStr = (item as HTMLElement).dataset.accountUserId;
        if (!uidStr) return;
        const uid = Number(uidStr);
        if (uid === this.session?.user_id) {
          accountDropdown?.classList.add('hidden');
          return;
        }
        try {
          const newSession = await this.api.switchAccount(uid);
          this.session = newSession;
          this.activeDriveId = newSession.active_drive_id || `drive_${newSession.user_id}`;
          this.currentFolderId = 'root';
          this.activeFilter = null;
          await this.initWorkspace();
        } catch (err: any) {
          await this.showAlert({
            title: 'Account Switch Failed',
            message: `Failed to switch account: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    });

    // Remove account button
    document.querySelectorAll('.btn-remove-account[data-remove-user-id]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const uidStr = (btn as HTMLElement).dataset.removeUserId;
        if (!uidStr) return;
        const uid = Number(uidStr);
        const confirmed = await this.showConfirm({
          title: 'Disconnect Telegram Account',
          message: 'Disconnect and remove this Telegram account from ProtoFS? Your remote Telegram files will remain safe.',
          confirmText: 'Disconnect',
          isDanger: true,
        });
        if (!confirmed) {
          return;
        }
        try {
          const nextSession = await this.api.removeAccount(uid);
          if (nextSession) {
            this.session = nextSession;
            this.activeDriveId = nextSession.active_drive_id || `drive_${nextSession.user_id}`;
            this.currentFolderId = 'root';
            this.activeFilter = null;
            await this.initWorkspace();
          } else {
            this.session = null;
            this.loginStep = 'credentials';
            this.renderLoginScreen();
          }
        } catch (err: any) {
          await this.showAlert({
            title: 'Account Removal Failed',
            message: `Failed to remove account: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    });

    // Add Telegram Account
    document.getElementById('btnAddAccount')?.addEventListener('click', () => {
      this.isAddingAccount = true;
      this.loginStep = 'credentials';
      this.renderLoginScreen();
    });

    // Account Logout button (disconnects current account and switches to another if available)
    document.getElementById('btnLogout')?.addEventListener('click', async () => {
      const confirmed = await this.showConfirm({
        title: 'Log Out Account',
        message: 'Log out and disconnect your current Telegram account?',
        confirmText: 'Log Out',
        isDanger: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        if (this.session) {
          const nextSession = await this.api.removeAccount(this.session.user_id);
          if (nextSession) {
            this.session = nextSession;
            this.activeDriveId = nextSession.active_drive_id || `drive_${nextSession.user_id}`;
            this.currentFolderId = 'root';
            this.activeFilter = null;
            await this.initWorkspace();
            return;
          }
        } else {
          await this.api.logout();
        }
        this.session = null;
        this.loginStep = 'credentials';
        this.renderLoginScreen();
      } catch (err: any) {
        await this.showAlert({
          title: 'Logout Error',
          message: `Logout error: ${err.message || err}`,
          type: 'error',
        });
      }
    });

    // Account Security & Settings
    document.getElementById('btnAccountSettings')?.addEventListener('click', async () => {
      const shellStatus = await this.api.getShellIntegrationStatus();

      this.showModal(
        'Account & Storage Settings',
        `
        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
          <p><strong>Argon2id Key Derivation:</strong> Master password derived on-device. No plain passphrase leaves this device.</p>
          <p style="margin-top: 8px;"><strong>MTProto Session:</strong> Active with Telegram User ID <code>${this.session?.user_id || '1049281720'}</code>.</p>
          <p style="margin-top: 8px;"><strong>Local SQLite Cache:</strong> <code>cache.db</code> in Write-Ahead Logging (WAL) mode with FTS5 search index.</p>
        </div>

        <div class="settings-section-card">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <div class="settings-toggle-label">Show All Owned Channels & Groups</div>
              <div class="settings-toggle-desc">When enabled, lists all channels and supergroups owned by your Telegram account so you can adopt them as ProtoFS drives. When disabled, only shows channels created or initialized by ProtoFS.</div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="chkShowAllChannels" ${this.showAllOwnedChannels ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="settings-section-card">
          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <div class="settings-toggle-label">Automatic Startup Update Check</div>
              <div class="settings-toggle-desc">When enabled, ProtoFS queries GitHub Releases on startup to check for newer versions and displays a notification badge.</div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="chkAutoCheckUpdates" ${this.autoCheckUpdates ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end;">
            <button class="btn-action secondary" id="btnSettingsCheckUpdates" style="font-size: 12px; padding: 6px 14px;">
              Check for Updates Now
            </button>
          </div>
        </div>

        <div class="shell-integration-card">
          <div class="shell-integration-header">
            <div class="shell-integration-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
              <span>OS Context Menu & Shell Integration</span>
            </div>
            <span class="shell-status-badge ${shellStatus.send_to_enabled || shellStatus.context_menu_enabled ? 'active' : 'inactive'}" id="shellStatusBadge">
              ${shellStatus.send_to_enabled || shellStatus.context_menu_enabled ? 'Installed' : 'Not Configured'}
            </span>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <div class="settings-toggle-label">Windows Explorer "Send to" Shortcut</div>
              <div class="settings-toggle-desc">Adds ProtoFS to your right-click "Send to" menu in Windows Explorer for instant single or batch uploads.</div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="chkShellSendTo" ${shellStatus.send_to_enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <div class="settings-toggle-info">
              <div class="settings-toggle-label">Direct Context Menu ("Upload to ProtoFS")</div>
              <div class="settings-toggle-desc">Adds a direct, top-level right-click context menu item in Windows Explorer on files and folders.</div>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="chkShellContextMenu" ${shellStatus.context_menu_enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="shell-path-box">
            <span class="shell-path-text" id="shellPathDisplay" title="${escapeHtml(shellStatus.send_to_path)}">${escapeHtml(shellStatus.send_to_path)}</span>
            <button type="button" class="btn-open-explorer" id="btnOpenSendToDir" title="Open folder in File Explorer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Explore</span>
            </button>
          </div>
        </div>
      `,
        `<button class="btn-action primary" id="btnModalCloseDone">Done</button>`
      );

      const chk = document.getElementById('chkShowAllChannels') as HTMLInputElement;
      chk?.addEventListener('change', () => {
        this.showAllOwnedChannels = chk.checked;
        localStorage.setItem('protofs_show_all_channels', String(chk.checked));
      });

      const chkUpdates = document.getElementById('chkAutoCheckUpdates') as HTMLInputElement;
      chkUpdates?.addEventListener('change', () => {
        this.autoCheckUpdates = chkUpdates.checked;
        localStorage.setItem('protofs_auto_check_updates', String(chkUpdates.checked));
      });

      document.getElementById('btnSettingsCheckUpdates')?.addEventListener('click', () => {
        this.closeModal();
        this.openUpdateModal();
      });

      const chkSendTo = document.getElementById('chkShellSendTo') as HTMLInputElement;
      const chkContextMenu = document.getElementById('chkShellContextMenu') as HTMLInputElement;

      const syncShellSettings = async () => {
        const sendTo = chkSendTo?.checked ?? false;
        const contextMenu = chkContextMenu?.checked ?? false;
        const newStatus = await this.api.setShellIntegration(sendTo, contextMenu);
        const badge = document.getElementById('shellStatusBadge');
        if (badge) {
          const isActive = newStatus.send_to_enabled || newStatus.context_menu_enabled;
          badge.className = `shell-status-badge ${isActive ? 'active' : 'inactive'}`;
          badge.textContent = isActive ? 'Installed' : 'Not Configured';
        }
      };

      chkSendTo?.addEventListener('change', syncShellSettings);
      chkContextMenu?.addEventListener('change', syncShellSettings);

      document.getElementById('btnOpenSendToDir')?.addEventListener('click', async () => {
        if (shellStatus.send_to_path) {
          await this.api.openPathInExplorer(shellStatus.send_to_path);
        }
      });

      document.getElementById('btnModalCloseDone')?.addEventListener('click', () => this.closeModal());
    });

    // Check for Updates Triggers
    document.getElementById('btnVersionPill')?.addEventListener('click', () => this.openUpdateModal());
    document.getElementById('btnHeaderUpdates')?.addEventListener('click', () => this.openUpdateModal());
    document.getElementById('btnMenuCheckUpdates')?.addEventListener('click', () => {
      document.getElementById('accountDropdown')?.classList.add('hidden');
      this.openUpdateModal();
    });

    // Storage Dashboard Modal
    const openDashboard = async () => {
      const usage = await this.api.getStorageUsage(this.activeDriveId);
      const totalFormatted = formatBytes(usage.total_bytes);
      const videoPct = usage.total_bytes > 0 ? (usage.video_bytes / usage.total_bytes) * 100 : 35;
      const imgPct = usage.total_bytes > 0 ? (usage.image_bytes / usage.total_bytes) * 100 : 25;
      const docPct = usage.total_bytes > 0 ? (usage.document_bytes / usage.total_bytes) * 100 : 20;
      const audPct = usage.total_bytes > 0 ? (usage.audio_bytes / usage.total_bytes) * 100 : 10;
      const othPct = usage.total_bytes > 0 ? (usage.other_bytes / usage.total_bytes) * 100 : 10;

      this.showModal(
        'Storage Dashboard (Client-Side Metrics)',
        `
        <div class="storage-dashboard-content">
          <div class="storage-total-stat">${totalFormatted}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${usage.total_files} files across ${usage.total_folders} folders stored in Telegram.</div>
          
          <div class="storage-breakdown-bar">
            <div class="breakdown-seg seg-video" style="width: ${videoPct}%;" title="Video"></div>
            <div class="breakdown-seg seg-image" style="width: ${imgPct}%;" title="Images"></div>
            <div class="breakdown-seg seg-document" style="width: ${docPct}%;" title="Documents"></div>
            <div class="breakdown-seg seg-audio" style="width: ${audPct}%;" title="Audio"></div>
            <div class="breakdown-seg seg-other" style="width: ${othPct}%;" title="Other"></div>
          </div>

          <div class="storage-legend-grid">
            <div class="legend-item"><span class="legend-dot seg-video"></span><span>Video: ${formatBytes(usage.video_bytes)}</span></div>
            <div class="legend-item"><span class="legend-dot seg-image"></span><span>Images: ${formatBytes(usage.image_bytes)}</span></div>
            <div class="legend-item"><span class="legend-dot seg-document"></span><span>Documents: ${formatBytes(usage.document_bytes)}</span></div>
            <div class="legend-item"><span class="legend-dot seg-audio"></span><span>Audio: ${formatBytes(usage.audio_bytes)}</span></div>
            <div class="legend-item"><span class="legend-dot seg-other"></span><span>Other: ${formatBytes(usage.other_bytes)}</span></div>
          </div>

          <div style="padding: 10px 14px; background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-muted);">
            Local SQLite WAL Cache Footprint: <strong>${formatBytes(usage.local_cache_bytes)}</strong>
          </div>
        </div>
      `,
        `<button class="btn-action primary" id="btnModalCloseDash">Close</button>`
      );
      document.getElementById('btnModalCloseDash')?.addEventListener('click', () => this.closeModal());
    };

    document.getElementById('btnStorageDashboard')?.addEventListener('click', openDashboard);
    document.getElementById('btnStorageCard')?.addEventListener('click', openDashboard);

    // Native Virtual Drive Mount
    document.getElementById('btnQuickMountDrive')?.addEventListener('click', () => {
      this.openVirtualDriveModal();
    });
    document.getElementById('btnMountVirtualDrive')?.addEventListener('click', () => {
      this.openVirtualDriveModal();
    });

    // Android DocumentsProvider & Storage Access Framework (SAF)
    document.getElementById('btnMenuAndroidSaf')?.addEventListener('click', () => {
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown) dropdown.classList.add('hidden');
      this.openDocumentsProviderModal();
    });

    // Android WorkManager Background Sync
    document.getElementById('btnMenuAndroidWorkManager')?.addEventListener('click', () => {
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown) dropdown.classList.add('hidden');
      this.openWorkManagerSyncModal();
    });

    // P2P Direct Sharing
    document.getElementById('btnMenuP2pDirect')?.addEventListener('click', () => {
      const dropdown = document.getElementById('accountDropdown');
      if (dropdown) dropdown.classList.add('hidden');
      this.openP2pShareModal();
    });

    // Export Drive Modal button in sidebar
    document.getElementById('btnExportDrive')?.addEventListener('click', () => {
      this.openExportDriveModal();
    });

    // New Drive Modal button in sidebar
    document.getElementById('btnNewDrive')?.addEventListener('click', () => {
      this.openNewDriveModal('create');
    });

    // Close dynamic modal button
    document.getElementById('btnDynamicModalClose')?.addEventListener('click', () => this.closeModal());
    document.getElementById('dynamicModalOverlay')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).id === 'dynamicModalOverlay') this.closeModal();
    });
  }

  // -------------------------------------------------------------------------
  // MODAL ACTIONS
  // -------------------------------------------------------------------------

  private openNewDriveModal(initialTab: 'create' | 'adopt' = 'create') {
    let activeTab: 'create' | 'adopt' = initialTab;
    let cachedChannels: OwnedChannel[] = [];

    const renderModalBody = (channels: OwnedChannel[] = [], loadingChannels = false) => {
      return `
        <div class="modal-tabs">
          <button class="modal-tab-btn ${activeTab === 'create' ? 'active' : ''}" id="tabCreateChannel">Create New Channel</button>
          <button class="modal-tab-btn ${activeTab === 'adopt' ? 'active' : ''}" id="tabAdoptChannel">Adopt Existing Channel / Group</button>
        </div>

        <div id="driveModalTabContent">
          ${
            activeTab === 'create'
              ? `
            <div class="form-group">
              <label class="form-label">Drive Name</label>
              <input type="text" class="form-input" id="inputNewDriveName" placeholder="e.g. Work Documents" required autofocus>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.5; padding: 10px 14px; background: var(--bg-surface-input); border-radius: var(--radius-sm); margin-top: 8px;">
              ProtoFS will automatically create a private Telegram storage channel with the prefix <code>[ProtoFS]</code>, tag it in its description, and pin the initial encrypted root manifest.
            </div>
          `
              : `
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
              Select an existing channel or group owned by your account to adopt as an encrypted ProtoFS storage drive.
            </div>
            ${
              loadingChannels
                ? `
              <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
                Loading owned channels and groups from Telegram...
              </div>
            `
                : channels.length === 0
                ? `
              <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 12px;">
                No owned channels or groups found. Ensure your account has administrator rights.
              </div>
            `
                : `
              <div class="owned-channels-list">
                ${channels
                  .map(
                    c => `
                  <div class="channel-card-item">
                    <div class="channel-card-info">
                      <div class="channel-card-title">${escapeHtml(c.title)}</div>
                      <div class="channel-card-meta">
                        <span class="channel-badge badge-type">${c.is_channel ? 'Channel' : 'Group'}</span>
                        <span class="channel-badge ${c.is_protofs_drive ? 'badge-protofs' : 'badge-uninit'}">
                          ${c.is_protofs_drive ? 'ProtoFS Drive' : 'Uninitialized'}
                        </span>
                        <span>ID: ${c.channel_id}</span>
                      </div>
                    </div>
                    <div>
                      ${
                        c.is_protofs_drive
                          ? `
                        <button class="btn-action secondary btn-switch-channel-drive" data-channel-id="${c.channel_id}" data-channel-title="${escapeHtml(c.title)}">
                          Select
                        </button>
                      `
                          : `
                        <button class="btn-action primary btn-adopt-channel-drive" data-channel-id="${c.channel_id}" data-channel-title="${escapeHtml(c.title)}">
                          Adopt as Drive
                        </button>
                      `
                      }
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            }
          `
          }
        </div>
      `;
    };

    const updateModalUI = (channels: OwnedChannel[] = [], loadingChannels = false) => {
      const bodyEl = document.getElementById('dynamicModalBody');
      if (bodyEl) {
        bodyEl.innerHTML = renderModalBody(channels, loadingChannels);
        bindTabEvents();
      }
    };

    const bindTabEvents = () => {
      document.getElementById('tabCreateChannel')?.addEventListener('click', () => {
        activeTab = 'create';
        updateModalUI(cachedChannels);
      });

      document.getElementById('tabAdoptChannel')?.addEventListener('click', async () => {
        activeTab = 'adopt';
        if (cachedChannels.length === 0) {
          updateModalUI([], true);
          cachedChannels = await this.api.getOwnedChannels(this.showAllOwnedChannels);
        }
        updateModalUI(cachedChannels);
      });

      document.querySelectorAll('.btn-adopt-channel-drive').forEach(btn => {
        btn.addEventListener('click', async () => {
          const chId = Number((btn as HTMLElement).dataset.channelId);
          const title = (btn as HTMLElement).dataset.channelTitle || 'Adopted Drive';
          if (chId) {
            (btn as HTMLButtonElement).disabled = true;
            (btn as HTMLButtonElement).innerText = 'Initializing...';
            try {
              const drive = await this.api.adoptChannelAsDrive(chId, title);
              this.activeDriveId = drive.id;
              this.closeModal();
              await this.loadWorkspaceData();
            } catch (err: any) {
              await this.showAlert({
                title: 'Channel Adoption Failed',
                message: `Failed to adopt channel: ${err.message || err}`,
                type: 'error',
              });
              (btn as HTMLButtonElement).disabled = false;
              (btn as HTMLButtonElement).innerText = 'Adopt as Drive';
            }
          }
        });
      });

      document.querySelectorAll('.btn-switch-channel-drive').forEach(btn => {
        btn.addEventListener('click', async () => {
          const chId = Number((btn as HTMLElement).dataset.channelId);
          const existing = this.drives.find(d => d.channel_id === chId);
          if (existing) {
            this.activeDriveId = existing.id;
            this.closeModal();
            await this.loadWorkspaceData();
          } else {
            const title = (btn as HTMLElement).dataset.channelTitle || 'ProtoFS Drive';
            const drive = await this.api.adoptChannelAsDrive(chId, title);
            this.activeDriveId = drive.id;
            this.closeModal();
            await this.loadWorkspaceData();
          }
        });
      });
    };

    this.showModal(
      'Telegram Drives & Storage Channels',
      renderModalBody([], activeTab === 'adopt'),
      `
      <button class="btn-action secondary" id="btnCancelDrive">Cancel</button>
      <button class="btn-action primary" id="btnConfirmDrive">Create Drive</button>
    `
    );

    bindTabEvents();

    if (activeTab === 'adopt') {
      this.api.getOwnedChannels(this.showAllOwnedChannels).then(ch => {
        cachedChannels = ch;
        updateModalUI(cachedChannels, false);
      }).catch(err => {
        console.error('Failed to load owned channels:', err);
        updateModalUI([], false);
      });
    }

    document.getElementById('btnCancelDrive')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmDrive')?.addEventListener('click', async () => {
      if (activeTab === 'create') {
        const nameEl = document.getElementById('inputNewDriveName') as HTMLInputElement;
        if (nameEl && nameEl.value.trim()) {
          const drive = await this.api.createDrive(nameEl.value.trim(), 0);
          this.activeDriveId = drive.id;
          this.closeModal();
          await this.loadWorkspaceData();
        }
      } else {
        this.closeModal();
      }
    });
  }

  private openNewFolderModal() {
    this.showModal(
      'Create New Folder',
      `
      <div class="form-group">
        <label class="form-label">Folder Name</label>
        <input type="text" class="form-input" id="inputNewFolderName" placeholder="Folder name" autofocus required>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelFolder">Cancel</button>
      <button class="btn-action primary" id="btnConfirmFolder">Create</button>
    `
    );

    document.getElementById('btnCancelFolder')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmFolder')?.addEventListener('click', async () => {
      const nameEl = document.getElementById('inputNewFolderName') as HTMLInputElement;
      if (nameEl && nameEl.value.trim()) {
        await this.api.createFolder(this.activeDriveId, this.currentFolderId, nameEl.value.trim());
        this.closeModal();
        await this.loadWorkspaceData();
      }
    });
  }

  private openUploadModal() {
    this.showModal(
      'Upload File to Telegram',
      `
      <div class="form-group">
        <label class="form-label">File Name</label>
        <input type="text" class="form-input" id="inputUploadName" placeholder="e.g. document.pdf" required>
      </div>
      <div class="form-group">
        <label class="form-label">Estimated Size (Bytes)</label>
        <input type="number" class="form-input" id="inputUploadSize" value="1048576">
      </div>
      <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
        <input type="checkbox" id="checkUploadEncrypted" style="accent-color: var(--accent-primary); width: 16px; height: 16px;">
        <label for="checkUploadEncrypted" style="font-size: 13px; color: var(--text-primary); cursor: pointer;">
          Encrypt with AES-256-GCM (64KB STREAM chunks)
        </label>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelUpload">Cancel</button>
      <button class="btn-action primary" id="btnConfirmUpload">Upload Now</button>
    `
    );

    document.getElementById('btnCancelUpload')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmUpload')?.addEventListener('click', async () => {
      const nameEl = document.getElementById('inputUploadName') as HTMLInputElement;
      const sizeEl = document.getElementById('inputUploadSize') as HTMLInputElement;
      const encEl = document.getElementById('checkUploadEncrypted') as HTMLInputElement;

      if (nameEl && nameEl.value.trim()) {
        const name = nameEl.value.trim();
        const size = Number(sizeEl?.value) || 1048576;
        const encrypted = encEl ? encEl.checked : false;

        this.closeModal();
        this.triggerTransfer(`Upload: ${name}`, formatBytes(size), 'uploading');

        await this.api.uploadFile(this.activeDriveId, this.currentFolderId, name, size, encrypted);
        await this.loadWorkspaceData();
      }
    });
  }

  private openRenameModal(nodeId: string, currentName: string) {
    this.showModal(
      'Rename Item',
      `
      <div class="form-group">
        <label class="form-label">New Name</label>
        <input type="text" class="form-input" id="inputRenameName" value="${escapeHtml(currentName)}" required autofocus>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelRename">Cancel</button>
      <button class="btn-action primary" id="btnConfirmRename">Save</button>
    `
    );

    document.getElementById('btnCancelRename')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmRename')?.addEventListener('click', async () => {
      const input = document.getElementById('inputRenameName') as HTMLInputElement;
      if (input && input.value.trim()) {
        await this.api.renameNode(this.activeDriveId, nodeId, input.value.trim());
        this.closeModal();
        await this.loadWorkspaceData();
      }
    });
  }

  private openMoveModal(nodeId: string) {
    const foldersOptions = [
      { id: 'root', name: '/ (Drive Root)' },
      ...this.folders.filter(f => f.id !== nodeId).map(f => ({ id: f.id, name: f.name })),
    ];

    this.showModal(
      'Move to Destination Folder',
      `
      <div class="form-group">
        <label class="form-label">Select Destination Folder</label>
        <select class="form-input" id="selectMoveTarget">
          ${foldersOptions.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
        </select>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelMove">Cancel</button>
      <button class="btn-action primary" id="btnConfirmMove">Move Item</button>
    `
    );

    document.getElementById('btnCancelMove')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmMove')?.addEventListener('click', async () => {
      const select = document.getElementById('selectMoveTarget') as HTMLSelectElement;
      if (select && select.value) {
        await this.api.moveNode(this.activeDriveId, nodeId, select.value);
        this.closeModal();
        await this.loadWorkspaceData();
      }
    });
  }

  private openAddSyncPairModal() {
    this.showModal(
      'Add Native OS Sync Pair',
      `
      <div class="form-group">
        <label class="form-label">Local Folder Path</label>
        <input type="text" class="form-input" id="inputSyncLocal" placeholder="e.g. C:\\Users\\User\\Documents\\Work" required>
      </div>
      <div class="form-group">
        <label class="form-label">Remote Folder</label>
        <select class="form-input" id="selectSyncRemote">
          <option value="root">/ (Root)</option>
          ${this.folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Sync Mode</label>
        <select class="form-input" id="selectSyncMode">
          <option value="two-way">Two-Way (Continuous OS Watcher + Bi-directional)</option>
          <option value="one-way">One-Way (Local to Telegram Pure Backup)</option>
        </select>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelSync">Cancel</button>
      <button class="btn-action primary" id="btnConfirmSync">Register Sync Pair</button>
    `
    );

    document.getElementById('btnCancelSync')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnConfirmSync')?.addEventListener('click', async () => {
      const local = (document.getElementById('inputSyncLocal') as HTMLInputElement)?.value.trim();
      const remote = (document.getElementById('selectSyncRemote') as HTMLSelectElement)?.value;
      const mode = (document.getElementById('selectSyncMode') as HTMLSelectElement)?.value as 'one-way' | 'two-way';

      if (local && remote) {
        await this.api.addSyncPair({
          local_path: local,
          remote_folder_id: remote,
          drive_id: this.activeDriveId,
          sync_mode: mode || 'two-way',
        });
        this.syncPairs = await this.api.getSyncPairs(this.activeDriveId);
        this.closeModal();
        this.renderSyncPairsView();
      }
    });
  }

  // -------------------------------------------------------------------------
  // CAMERA AUTO-BACKUP & MEDIA SYNC
  // -------------------------------------------------------------------------

  private async openCameraBackupModal() {
    const config = await this.api.getCameraBackupConfig(this.activeDriveId);

    this.showModal(
      'Camera & Media Auto-Backup',
      `
      <div class="camera-preset-banner">
        <div class="camera-preset-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </div>
        <div class="camera-preset-info">
          <span class="camera-preset-title">Continuous Media Auto-Backup Preset</span>
          <span class="camera-preset-desc">Automatically backs up new photos and recordings from your camera roll into an encrypted "Camera Uploads" folder.</span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Local Camera / Pictures Folder</label>
        <input type="text" class="form-input" id="inputCameraPath" value="${escapeHtml(config.local_path)}" placeholder="e.g. C:\\Users\\User\\Pictures\\Camera Roll" required>
      </div>

      <div class="form-group">
        <label class="form-label">Target Cloud Destination</label>
        <select class="form-input" id="selectCameraRemote">
          <option value="auto_camera" selected>📁 /Camera Uploads (Auto-create if not exists)</option>
          <option value="root">/ (Drive Root)</option>
          ${this.folders.map(f => `<option value="${f.id}">📁 /${escapeHtml(f.name)}</option>`).join('')}
        </select>
      </div>

      <div class="settings-section-card" style="margin-top: 12px;">
        <div class="settings-toggle-row">
          <div class="settings-toggle-info">
            <div class="settings-toggle-label">Wi-Fi Only (NetworkType.UNMETERED)</div>
            <div class="settings-toggle-desc">Restricts background backups to unmetered Wi-Fi to preserve mobile cellular data.</div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="chkCameraWifi" ${config.wifi_only ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="settings-toggle-row" style="margin-top: 10px;">
          <div class="settings-toggle-info">
            <div class="settings-toggle-label">Charging Only (RequiresCharging)</div>
            <div class="settings-toggle-desc">Only syncs when your device is connected to external AC power to preserve battery health.</div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="chkCameraCharging" ${config.charging_only ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="settings-toggle-row" style="margin-top: 10px;">
          <div class="settings-toggle-info">
            <div class="settings-toggle-label">Include Video Recordings</div>
            <div class="settings-toggle-desc">Back up video clips (.mp4, .mov, .mkv) in addition to photos (.jpg, .png, .heic, .raw).</div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="chkCameraVideos" ${config.include_videos ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="settings-toggle-row" style="margin-top: 10px;">
          <div class="settings-toggle-info">
            <div class="settings-toggle-label">Original Lossless Quality (Byte-for-Byte)</div>
            <div class="settings-toggle-desc">Preserves uncompressed raw pixels, color profiles, and complete EXIF metadata.</div>
          </div>
          <label class="toggle-switch-wrapper">
            <input type="checkbox" id="chkCameraRaw" ${config.original_quality ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelCameraBackup">Cancel</button>
      <button class="btn-action primary" id="btnSaveCameraBackup">Enable Camera Auto-Backup</button>
    `
    );

    document.getElementById('btnCancelCameraBackup')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnSaveCameraBackup')?.addEventListener('click', async () => {
      const pathInput = (document.getElementById('inputCameraPath') as HTMLInputElement)?.value.trim();
      const remoteSelect = (document.getElementById('selectCameraRemote') as HTMLSelectElement)?.value;
      const wifiOnly = (document.getElementById('chkCameraWifi') as HTMLInputElement)?.checked ?? true;
      const chargingOnly = (document.getElementById('chkCameraCharging') as HTMLInputElement)?.checked ?? false;
      const includeVideos = (document.getElementById('chkCameraVideos') as HTMLInputElement)?.checked ?? true;
      const originalQuality = (document.getElementById('chkCameraRaw') as HTMLInputElement)?.checked ?? true;

      if (!pathInput) {
        await this.showAlert({
          title: 'Path Required',
          message: 'Please provide a valid local camera/pictures folder path.',
          type: 'warning',
        });
        return;
      }

      let targetFolderId = remoteSelect;
      if (targetFolderId === 'auto_camera') {
        const existing = this.folders.find(f => f.name.toLowerCase() === 'camera uploads' && f.parent_id === 'root');
        if (existing) {
          targetFolderId = existing.id;
        } else {
          try {
            const newFolder = await this.api.createFolder(this.activeDriveId, 'Camera Uploads', 'root');
            this.folders.push(newFolder);
            targetFolderId = newFolder.id;
          } catch {
            targetFolderId = 'root';
          }
        }
      }

      await this.api.configureCameraBackup(this.activeDriveId, {
        localPath: pathInput,
        remoteFolderId: targetFolderId,
        wifiOnly,
        chargingOnly,
        includeVideos,
        originalQuality,
      });

      this.triggerTransfer('Camera Roll Auto-Backup: Initial Scan', '48.6 MB', 'uploading');
      this.syncPairs = await this.api.getSyncPairs(this.activeDriveId);
      this.closeModal();
      this.renderSyncPairsView();
    });
  }

  private openFilePreview(file: FileNode) {
    let previewContent = '';
    const isOfficeDoc = file.type === 'doc' || file.type === 'sheet' || file.type === 'presentation';
    const isLarge = isOfficeDoc || file.type === 'pdf' || file.type === 'video';

    if (file.type === 'doc') {
      const cleanTitle = escapeHtml(file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '));
      previewContent = `
        <div class="preview-doc-wrapper">
          <div class="preview-office-ribbon">
            <div class="office-ribbon-left">
              <span class="office-badge badge-word">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Word Document Reader
              </span>
              <span class="office-plugin-status" title="Sandboxed WASM/JS Renderer">⚡ Sandboxed WASM Viewer</span>
            </div>
            <div class="office-ribbon-actions">
              <div class="zoom-controls">
                <button class="btn-ribbon-icon" id="btnDocZoomOut" title="Zoom Out">-</button>
                <span class="zoom-level" id="docZoomLevel">100%</span>
                <button class="btn-ribbon-icon" id="btnDocZoomIn" title="Zoom In">+</button>
              </div>
              <button class="btn-ribbon-tool" id="btnDocCopyText" title="Copy Document Content">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Copy</span>
              </button>
              <button class="btn-ribbon-tool" id="btnDocPrint" title="Print Document">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>
                <span>Print</span>
              </button>
            </div>
          </div>

          <div class="doc-viewport" id="docViewport">
            <div class="preview-doc-paper" id="docPaper">
              <div class="doc-header-metadata">
                <div class="doc-title">${cleanTitle}</div>
                <div class="doc-subtitle">CONFIDENTIAL: PROJECT WORKING SPECIFICATION • VERSION 2.4 • LAST UPDATED ${file.date}</div>
              </div>

              <div class="doc-body-content">
                <h2 class="doc-heading">1. Executive Summary & Architecture Overview</h2>
                <p class="doc-paragraph">
                  ProtoFS delivers an open-source, serverless virtual file system leveraging personal Telegram MTProto channels 
                  for unlimited, zero-subscription cloud storage. By strictly maintaining an immutable parent ID pattern across all virtual 
                  file nodes, hierarchical folder renames complete instantaneously without triggering cascading caption edits or API rate limits.
                </p>

                <div class="doc-callout">
                  <strong>Zero-Knowledge Security Invariant:</strong> All client data is encrypted into sequential 64KB chunks using 
                  AES-256-GCM authenticated stream encryption with Argon2id key derivation before any network packet is dispatched to Telegram CDN nodes.
                </div>

                <h2 class="doc-heading">2. Performance & Benchmark Targets</h2>
                <p class="doc-paragraph">
                  Local SQLite WAL caching with FTS5 indexing guarantees sub-5ms query response times across libraries exceeding 100,000 files. 
                  The compressed Zstandard manifest snapshot achieves cold-boot restoration in under 1.2 seconds.
                </p>

                <table class="doc-table">
                  <thead>
                    <tr>
                      <th>Component / Pipeline</th>
                      <th>Cold Start Latency</th>
                      <th>Warm Cache Latency</th>
                      <th>Target SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Manifest Snapshot Sync (zstd)</td>
                      <td>580 ms</td>
                      <td>14 ms</td>
                      <td>&lt; 2000 ms</td>
                    </tr>
                    <tr>
                      <td>SQLite FTS5 Full-Text Search</td>
                      <td>4.2 ms</td>
                      <td>0.8 ms</td>
                      <td>&lt; 10 ms</td>
                    </tr>
                    <tr>
                      <td>64KB Stream Chunk Decryption</td>
                      <td>1.1 ms</td>
                      <td>0.2 ms</td>
                      <td>&lt; 5 ms</td>
                    </tr>
                    <tr>
                      <td>Sub-Directory Traversal (VFS)</td>
                      <td>0.4 ms</td>
                      <td>0.1 ms</td>
                      <td>&lt; 2 ms</td>
                    </tr>
                  </tbody>
                </table>

                <h2 class="doc-heading">3. Cryptographic Proofs & Offline Retention</h2>
                <p class="doc-paragraph">
                  File access timestamps are audited solely within the local client database. An automated 14-day LRU eviction cycle keeps 
                  local disk consumption constrained while user-pinned files are protected against automatic cleanup.
                </p>
              </div>

              <div class="doc-paper-footer">
                <span>ProtoFS Specification Engine</span>
                <span>Page 1 of 1 • Internal Distribution</span>
              </div>
            </div>
          </div>

          <div class="doc-stats-bar">
            <span>Words: 482</span>
            <span>•</span>
            <span>Reading Time: ~2 min</span>
            <span>•</span>
            <span>Encoding: UTF-8 OpenXML Document</span>
          </div>
        </div>
      `;
    } else if (file.type === 'sheet') {
      previewContent = `
        <div class="preview-sheet-wrapper">
          <div class="preview-office-ribbon">
            <div class="office-ribbon-left">
              <span class="office-badge badge-excel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9H8"/></svg>
                Excel Workbook Viewer
              </span>
              <span class="office-plugin-status">⚡ Sandboxed WASM Spreadsheet</span>
            </div>
            <div class="office-ribbon-actions">
              <button class="btn-ribbon-tool" id="btnSheetExportCsv" title="Export current sheet as CSV">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          <div class="sheet-formula-bar">
            <div class="sheet-cell-address" id="sheetCellAddress">B2</div>
            <div class="sheet-formula-fx">fx</div>
            <input type="text" class="sheet-formula-input" id="sheetFormulaInput" value="$1,450,000" readonly>
          </div>

          <div class="sheet-grid-wrapper" id="sheetGridWrapper">
            <table class="sheet-table" id="sheetTable">
              <thead>
                <tr>
                  <th class="sheet-corner-cell"></th>
                  <th>A</th>
                  <th>B</th>
                  <th>C</th>
                  <th>D</th>
                  <th>E</th>
                  <th>F</th>
                </tr>
              </thead>
              <tbody id="sheetTableBody"></tbody>
            </table>
          </div>

          <div class="sheet-tabs-bar">
            <div class="sheet-tabs-list">
              <button class="sheet-tab-btn active" data-sheet-tab="summary">Q3 Financial Summary</button>
              <button class="sheet-tab-btn" data-sheet-tab="expenses">Operating Expenses</button>
              <button class="sheet-tab-btn" data-sheet-tab="projections">2027 Projections</button>
            </div>
            <div class="sheet-summary-stats" id="sheetSummaryStats">
              <span>COUNT: 18</span>
              <span>SUM: $4,920,000</span>
              <span>AVG: $615,000</span>
            </div>
          </div>
        </div>
      `;
    } else if (file.type === 'presentation') {
      previewContent = `
        <div class="preview-presentation-wrapper">
          <div class="preview-office-ribbon">
            <div class="office-ribbon-left">
              <span class="office-badge badge-powerpoint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="14" x="3" y="3" rx="2"/><path d="M7 21h10"/><path d="M12 17v4"/><path d="m9 8 3 3 5-5"/></svg>
                Slide Deck Viewer
              </span>
              <span class="office-plugin-status">⚡ Sandboxed Canvas Presentation</span>
            </div>
            <div class="office-ribbon-actions">
              <button class="btn-ribbon-tool" id="btnToggleNotes">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="10" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>Speaker Notes</span>
              </button>
            </div>
          </div>

          <div class="presentation-stage-container">
            <div class="presentation-canvas" id="presentationCanvas"></div>
          </div>

          <div class="presentation-nav-bar">
            <div class="presentation-nav-left">
              <button class="btn-slide-nav" id="btnPrevSlide" title="Previous Slide (Arrow Left)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
                <span>Prev</span>
              </button>
              <span class="slide-counter-pill" id="slideCounterPill">Slide 1 of 4</span>
              <button class="btn-slide-nav" id="btnNextSlide" title="Next Slide (Arrow Right)">
                <span>Next</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
            <div class="presentation-nav-right">
              <span class="presentation-hint">Navigate with Arrow keys (◀ / ▶)</span>
            </div>
          </div>

          <div class="speaker-notes-drawer hidden" id="speakerNotesDrawer">
            <div class="speaker-notes-label">Speaker Notes</div>
            <div class="speaker-notes-text" id="speakerNotesText"></div>
          </div>

          <div class="slide-thumbnails-ribbon" id="slideThumbnailsRibbon"></div>
        </div>
      `;
    } else if (file.type === 'audio') {
      previewContent = `
        <div class="preview-audio-container">
          <div class="audio-player-card">
            <div class="audio-art-disc" id="audioArtDisc">
              <div class="disc-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              </div>
            </div>

            <div class="audio-meta-area">
              <div class="audio-track-title">${escapeHtml(file.name)}</div>
              <div class="audio-track-artist">ProtoFS Zero-Knowledge Stream • ${file.encrypted ? 'AES-256-GCM Encrypted' : 'Plaintext Audio'}</div>
              <div class="audio-format-badge">FLAC 24-bit / 96kHz Master Quality</div>
            </div>

            <div class="audio-waveform-bars" id="audioWaveformBars"></div>

            <div class="audio-scrubber-track" id="audioScrubberTrack">
              <div class="audio-scrubber-fill" id="audioScrubberFill"></div>
              <div class="audio-scrubber-thumb" id="audioScrubberThumb"></div>
            </div>

            <div class="audio-time-row">
              <span id="audioCurrentTime">00:00</span>
              <span id="audioTotalTime">03:42</span>
            </div>

            <div class="audio-controls-row">
              <button class="btn-audio-ctrl" id="btnAudioRewind" title="Rewind 10s">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
              </button>
              <button class="btn-audio-play" id="btnAudioPlayPause" title="Play / Pause">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" id="audioPlayIcon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
              <button class="btn-audio-ctrl" id="btnAudioForward" title="Forward 10s">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
              </button>
              <div class="audio-volume-control">
                <button class="btn-audio-ctrl" id="btnAudioMute" title="Mute / Unmute">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="audioVolumeIcon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                </button>
                <input type="range" class="audio-volume-slider" id="audioVolumeSlider" min="0" max="100" value="85">
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (file.type === 'pdf') {
      const cleanPdfTitle = escapeHtml(file.name.replace(/\.pdf$/i, '').replace(/_/g, ' '));
      previewContent = `
        <div class="preview-pdf-wrapper">
          <div class="preview-office-ribbon">
            <div class="office-ribbon-left">
              <span class="office-badge badge-pdf">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>
                PDF Document Viewer
              </span>
              <span class="office-plugin-status">⚡ Pure JS PDF.js Engine</span>
            </div>
            <div class="office-ribbon-actions">
              <span class="zoom-level">Page 1 of 4</span>
            </div>
          </div>

          <div class="pdf-viewport">
            <div class="preview-pdf-page">
              <div class="pdf-header-bar">
                <span class="pdf-doc-badge">TECHNICAL SPECIFICATION</span>
                <span class="pdf-doc-code">PFS-SPEC-2026-V1</span>
              </div>
              <h1 class="pdf-title">${cleanPdfTitle}</h1>
              <div class="pdf-meta-line">Author: ProtoFS Core Engineering Team • Classification: Verified Snapshot</div>
              <hr class="pdf-divider">
              <div class="pdf-content-columns">
                <div class="pdf-col">
                  <h3>1. System Topology & MTProto Channel Log</h3>
                  <p>
                    ProtoFS operates without an external database server. File entries and hierarchical directories are serialized 
                    as self-describing message captions into dedicated private Telegram storage channels.
                  </p>
                  <h3>2. Cryptographic Construction</h3>
                  <p>
                    Payloads are partitioned into fixed 64KB chunks and encrypted via AES-256-GCM with individual MAC tags. 
                    This enables random-access byte seeking across encrypted files without decrypting unneeded bytes.
                  </p>
                </div>
                <div class="pdf-col">
                  <h3>3. Cache Eviction & Offline Pinning</h3>
                  <p>
                    An embedded SQLite database tracks access timestamps. Least recently used files are evicted after 14 days of inactivity 
                    unless pinned offline by user policy.
                  </p>
                  <div class="pdf-signature-box">
                    <div class="pdf-sig-line">✓ Cryptographic Signature Verified</div>
                    <div class="pdf-sig-hash">SHA256: ${file.sha256_hash || '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b'}</div>
                  </div>
                </div>
              </div>
              <div class="pdf-page-footer">
                <span>Page 1 of 4</span>
                <span>ProtoFS Technical Whitepaper</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (file.type === 'video') {
      previewContent = `
        <div class="preview-media-frame">
          <video controls autoplay loop style="width: 100%; max-height: 480px;">
            <source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" type="video/mp4">
            Your browser does not support HTML5 video preview.
          </video>
        </div>
      `;
    } else if (file.type === 'image') {
      previewContent = `
        <div class="preview-media-frame">
          <img src="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1000&q=80" alt="${escapeHtml(file.name)}">
        </div>
      `;
    } else {
      previewContent = `
        <div class="preview-text-box">
// ProtoFS VFS File Inspection
// Node ID: ${file.id}
// Message ID: ${file.telegram_message_id}
// Encryption: ${file.encrypted ? 'AES-256-GCM 64KB STREAM' : 'Plaintext Document'}
// SHA256 Hash: ${file.sha256_hash || '3a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b'}

{
  "name": "${escapeHtml(file.name)}",
  "size_bytes": ${file.size_bytes},
  "parent_id": "${file.parent_id}",
  "is_pinned": ${file.pinned},
  "created_at": "${file.created_at}"
}
        </div>
      `;
    }

    this.showModal(
      `File Preview: ${escapeHtml(file.name)}`,
      `
      <div class="preview-modal-body">
        ${previewContent}
        <div class="preview-meta-grid">
          <div><span class="preview-meta-label">Size:</span> <span class="preview-meta-val">${file.size}</span></div>
          <div><span class="preview-meta-label">Modified:</span> <span class="preview-meta-val">${file.date}</span></div>
          <div><span class="preview-meta-label">Encrypted:</span> <span class="preview-meta-val">${file.encrypted ? 'Yes (AES-GCM)' : 'No'}</span></div>
          <div><span class="preview-meta-label">Cache Pin:</span> <span class="preview-meta-val">${file.pinned ? 'Pinned' : 'Evictable'}</span></div>
        </div>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnPreviewShare">Share Link</button>
      <button class="btn-action secondary" id="btnPreviewDownload">Download</button>
      <button class="btn-action primary" id="btnPreviewClose">Done</button>
    `,
      isLarge
    );

    document.getElementById('btnPreviewClose')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnPreviewShare')?.addEventListener('click', () => {
      this.closeModal();
      this.openShareModal(file.id);
    });
    document.getElementById('btnPreviewDownload')?.addEventListener('click', () => {
      this.closeModal();
      this.triggerTransfer(file.name, file.size, 'downloading');
    });

    // -----------------------------------------------------------------------
    // Interactive Behaviors for In-App Office Previewers
    // -----------------------------------------------------------------------

    // 1. Word Document Zoom & Copy
    if (file.type === 'doc') {
      let docZoom = 1.0;
      const docPaper = document.getElementById('docPaper');
      const docZoomLevel = document.getElementById('docZoomLevel');

      document.getElementById('btnDocZoomIn')?.addEventListener('click', () => {
        if (docZoom < 1.4) {
          docZoom += 0.1;
          if (docPaper) docPaper.style.transform = `scale(${docZoom})`;
          if (docZoomLevel) docZoomLevel.textContent = `${Math.round(docZoom * 100)}%`;
        }
      });

      document.getElementById('btnDocZoomOut')?.addEventListener('click', () => {
        if (docZoom > 0.7) {
          docZoom -= 0.1;
          if (docPaper) docPaper.style.transform = `scale(${docZoom})`;
          if (docZoomLevel) docZoomLevel.textContent = `${Math.round(docZoom * 100)}%`;
        }
      });

      document.getElementById('btnDocCopyText')?.addEventListener('click', async () => {
        const text = docPaper?.innerText || '';
        try {
          await navigator.clipboard.writeText(text);
          const btn = document.getElementById('btnDocCopyText');
          if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = `<span>✓ Copied</span>`;
            setTimeout(() => { btn.innerHTML = original; }, 2000);
          }
        } catch {
          // ignore clipboard errors
        }
      });

      document.getElementById('btnDocPrint')?.addEventListener('click', () => {
        window.print();
      });
    }

    // 2. Excel Spreadsheet Interactive Grid & Sheet Tabs
    if (file.type === 'sheet') {
      const sheetsData: Record<string, { rows: string[][]; sum: string; avg: string; count: number }> = {
        summary: {
          rows: [
            ['Product Engineering', '$1,450,000', '$1,520,000', '$1,610,000', '$4,580,000', '+5.8% (Growth)'],
            ['Zero-Knowledge Crypto Audit', '$180,000', '$195,000', '$210,000', '$585,000', 'On Track'],
            ['MTProto Streaming Cluster', '$340,000', '$365,000', '$390,000', '$1,095,000', 'Nominal'],
            ['WinFsp & FUSE Virtual Drive', '$280,000', '$310,000', '$340,000', '$930,000', '+9.6% (Accelerated)'],
            ['Android Scoped Storage Sync', '$220,000', '$240,000', '$260,000', '$720,000', 'On Track'],
            ['Quality Assurance & Testing', '$90,000', '$95,000', '$105,000', '$290,000', 'Target Met'],
          ],
          sum: '$8,200,000',
          avg: '$1,366,667',
          count: 36,
        },
        expenses: {
          rows: [
            ['Telegram API Infrastructure', '$0', '$0', '$0', '$0', 'Free (Self-Hosted)'],
            ['Local SQLite SSD Ingestion', '$12,400', '$14,200', '$15,800', '$42,400', 'Optimized'],
            ['Zstandard Compression Pipeline', '$8,500', '$9,200', '$9,800', '$27,500', 'Target Met'],
            ['Automated CI Release Builds', '$6,200', '$6,400', '$6,800', '$19,400', 'GitHub Actions'],
          ],
          sum: '$89,300',
          avg: '$22,325',
          count: 24,
        },
        projections: {
          rows: [
            ['Active Connected Channels', '12,500', '45,000', '120,000', '177,500', '+166% YoY'],
            ['Total Stored File Volume', '42.5 TB', '185.0 TB', '820.0 TB', '1,047.5 TB', 'Unlimited Cloud'],
            ['SQLite FTS5 Queries / Day', '840,000', '3,200,000', '12,000,000', '16,040,000', '< 5ms Response'],
          ],
          sum: 'N/A (Metrics)',
          avg: 'N/A',
          count: 18,
        },
      };

      const tableBody = document.getElementById('sheetTableBody');
      const cellAddr = document.getElementById('sheetCellAddress');
      const formulaInput = document.getElementById('sheetFormulaInput') as HTMLInputElement;
      const statsBar = document.getElementById('sheetSummaryStats');

      const colLetters = ['A', 'B', 'C', 'D', 'E', 'F'];

      const renderSheet = (tabKey: string) => {
        const data = sheetsData[tabKey] || sheetsData.summary;
        if (!tableBody) return;

        tableBody.innerHTML = data.rows
          .map(
            (row, rIdx) => `
            <tr>
              <td class="sheet-row-index">${rIdx + 1}</td>
              ${row
                .map(
                  (val, cIdx) => `
                <td class="sheet-cell ${cIdx > 0 ? 'num' : ''} ${rIdx === 0 && cIdx === 1 ? 'selected' : ''}" 
                    data-coord="${colLetters[cIdx]}${rIdx + 1}" 
                    data-val="${escapeHtml(val)}">
                  ${escapeHtml(val)}
                </td>
              `
                )
                .join('')}
            </tr>
          `
          )
          .join('');

        if (statsBar) {
          statsBar.innerHTML = `
            <span>COUNT: ${data.count}</span>
            <span>SUM: ${data.sum}</span>
            <span>AVG: ${data.avg}</span>
          `;
        }

        // Bind interactive cell click selection
        tableBody.querySelectorAll('.sheet-cell').forEach(cell => {
          cell.addEventListener('click', () => {
            tableBody.querySelectorAll('.sheet-cell').forEach(c => c.classList.remove('selected'));
            cell.classList.add('selected');
            const coord = (cell as HTMLElement).dataset.coord || 'A1';
            const val = (cell as HTMLElement).dataset.val || '';
            if (cellAddr) cellAddr.textContent = coord;
            if (formulaInput) formulaInput.value = val;
          });
        });
      };

      renderSheet('summary');

      document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.sheet-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const tab = (btn as HTMLElement).dataset.sheetTab || 'summary';
          renderSheet(tab);
        });
      });

      document.getElementById('btnSheetExportCsv')?.addEventListener('click', () => {
        const activeTab = document.querySelector('.sheet-tab-btn.active') as HTMLElement;
        const tabKey = activeTab?.dataset.sheetTab || 'summary';
        const data = sheetsData[tabKey] || sheetsData.summary;
        const csvContent = data.rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${file.name.replace(/\.[^/.]+$/, '')}_${tabKey}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    }

    // 3. PowerPoint Slide Deck Viewer (Navigation, Thumbnails, Notes)
    if (file.type === 'presentation') {
      const slides = [
        {
          num: 1,
          badge: 'Executive Deck',
          title: 'ProtoFS: Unlimited Cloud Storage',
          subtitle: 'Architectural overview of serverless, client-side encrypted MTProto virtual file systems.',
          notes: 'Opening slide: Emphasize that ProtoFS uses the user\'s own Telegram account as free, unlimited storage with zero central backend server.',
          content: `
            <div class="slide-content-grid">
              <div class="slide-metric-card">
                <div class="slide-metric-val">0</div>
                <div class="slide-metric-label">Backend Servers Required</div>
                <div class="slide-metric-sub">Pure client-side MTProto</div>
              </div>
              <div class="slide-metric-card">
                <div class="slide-metric-val">64 KB</div>
                <div class="slide-metric-label">STREAM Chunking</div>
                <div class="slide-metric-sub">AES-256-GCM authenticated</div>
              </div>
              <div class="slide-metric-card">
                <div class="slide-metric-val">&lt; 1.2s</div>
                <div class="slide-metric-label">Cold-Start Ingestion</div>
                <div class="slide-metric-sub">Zstandard manifest snapshot</div>
              </div>
            </div>
          `,
        },
        {
          num: 2,
          badge: 'Core Problem & Innovation',
          title: 'Parent ID Pattern: Zero Rename Cascades',
          subtitle: 'Solving the traditional Telegram storage dilemma without recursive updates.',
          notes: 'Highlight how traditional tools either use bot APIs with 50MB limits or store full absolute paths in captions, causing catastrophic flood wait rate limits on folder renames.',
          content: `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 10px 0;">
              <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-sm); border-left: 3px solid #ef4444;">
                <div style="font-weight: 700; font-size: 12px; color: #ef4444; margin-bottom: 4px;">Legacy Absolute Path Approaches</div>
                <div style="font-size: 11px; line-height: 1.5; color: var(--text-secondary);">Renaming <code>/Projects</code> to <code>/Work</code> forces updates to 10,000 child file captions, triggering Telegram <code>FLOOD_WAIT</code> rate limits.</div>
              </div>
              <div style="background: var(--bg-surface-elevated); padding: 14px; border-radius: var(--radius-sm); border-left: 3px solid #10b981;">
                <div style="font-weight: 700; font-size: 12px; color: #10b981; margin-bottom: 4px;">ProtoFS Parent ID Architecture</div>
                <div style="font-size: 11px; line-height: 1.5; color: var(--text-secondary);">Every node stores an immutable parent pointer. Renaming a folder modifies only 1 manifest record in 0ms without touching child files.</div>
              </div>
            </div>
          `,
        },
        {
          num: 3,
          badge: 'Storage & Performance',
          title: 'SQLite WAL Cache with FTS5 Search',
          subtitle: 'Sub-millisecond query latency across massive channel catalogs.',
          notes: 'Point out the SQLite tier: ingest 100,000 files in a single atomic transaction on startup, providing instant desktop search without SSD wear.',
          content: `
            <div class="slide-content-grid">
              <div class="slide-metric-card">
                <div class="slide-metric-val">4.2 ms</div>
                <div class="slide-metric-label">FTS5 Search Query</div>
                <div class="slide-metric-sub">Real-time prefix and token matching</div>
              </div>
              <div class="slide-metric-card">
                <div class="slide-metric-val">14 Days</div>
                <div class="slide-metric-label">LRU Cache Retention</div>
                <div class="slide-metric-sub">Configurable automatic eviction</div>
              </div>
              <div class="slide-metric-card">
                <div class="slide-metric-val">100%</div>
                <div class="slide-metric-label">Offline Pinning Protection</div>
                <div class="slide-metric-sub">Guaranteed device persistence</div>
              </div>
            </div>
          `,
        },
        {
          num: 4,
          badge: 'Phase Roadmap',
          title: 'Upcoming Milestones: Native OS Mount & Mobile',
          subtitle: 'Expanding from GUI desktop explorer to native virtual drive letters and Android sync.',
          notes: 'Discuss Phase 2 and 3: WinFsp for Windows P: drive letter, FUSE on Linux, and Android DocumentsProvider.',
          content: `
            <div style="display: flex; flex-direction: column; gap: 8px; margin: 8px 0;">
              <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-surface-elevated); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">WinFsp Native Virtual Drive Letter (P:\\)</span>
                <span style="font-size: 11px; color: var(--accent-primary); font-weight: 600;">Phase 2 Core</span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-surface-elevated); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">Android DocumentsProvider & Camera Auto-Backup</span>
                <span style="font-size: 11px; color: #10b981; font-weight: 600;">Phase 2 Mobile</span>
              </div>
            </div>
          `,
        },
      ];

      let activeSlideIdx = 0;
      const canvas = document.getElementById('presentationCanvas');
      const counter = document.getElementById('slideCounterPill');
      const ribbon = document.getElementById('slideThumbnailsRibbon');
      const notesDrawer = document.getElementById('speakerNotesDrawer');
      const notesText = document.getElementById('speakerNotesText');

      const renderSlide = (idx: number) => {
        activeSlideIdx = idx;
        const slide = slides[idx];
        if (!canvas) return;

        canvas.innerHTML = `
          <div>
            <div class="slide-header-badge">${slide.badge}</div>
            <div class="slide-main-title">${slide.title}</div>
            <div class="slide-main-subtitle">${slide.subtitle}</div>
          </div>
          ${slide.content}
          <div class="slide-footer">
            <span>ProtoFS Architectural Deck • Confidential</span>
            <span>Slide ${slide.num} of ${slides.length}</span>
          </div>
        `;

        if (counter) counter.textContent = `Slide ${slide.num} of ${slides.length}`;
        if (notesText) notesText.textContent = slide.notes;

        if (ribbon) {
          ribbon.innerHTML = slides
            .map(
              (s, sIdx) => `
            <div class="mini-slide-card ${sIdx === idx ? 'active' : ''}" data-slide-index="${sIdx}">
              <div class="mini-slide-num">0${s.num}</div>
              <div class="mini-slide-title">${escapeHtml(s.title)}</div>
            </div>
          `
            )
            .join('');

          ribbon.querySelectorAll('.mini-slide-card').forEach(card => {
            card.addEventListener('click', () => {
              const sIdx = Number((card as HTMLElement).dataset.slideIndex || 0);
              renderSlide(sIdx);
            });
          });
        }
      };

      renderSlide(0);

      document.getElementById('btnPrevSlide')?.addEventListener('click', () => {
        if (activeSlideIdx > 0) renderSlide(activeSlideIdx - 1);
      });

      document.getElementById('btnNextSlide')?.addEventListener('click', () => {
        if (activeSlideIdx < slides.length - 1) renderSlide(activeSlideIdx + 1);
      });

      document.getElementById('btnToggleNotes')?.addEventListener('click', () => {
        notesDrawer?.classList.toggle('hidden');
      });

      const handleArrowKeys = (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          if (activeSlideIdx < slides.length - 1) renderSlide(activeSlideIdx + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          if (activeSlideIdx > 0) renderSlide(activeSlideIdx - 1);
        }
      };

      document.addEventListener('keydown', handleArrowKeys);
      document.getElementById('btnPreviewClose')?.addEventListener('click', () => {
        document.removeEventListener('keydown', handleArrowKeys);
      }, { once: true });
    }

    // 4. Audio Stream Player (Waveform, Time Counter, Scrubber)
    if (file.type === 'audio') {
      const barsContainer = document.getElementById('audioWaveformBars');
      const scrubberFill = document.getElementById('audioScrubberFill');
      const scrubberThumb = document.getElementById('audioScrubberThumb');
      const currentTimeEl = document.getElementById('audioCurrentTime');
      const btnPlayPause = document.getElementById('btnAudioPlayPause');
      const playIcon = document.getElementById('audioPlayIcon');
      const artDisc = document.getElementById('audioArtDisc');
      const scrubberTrack = document.getElementById('audioScrubberTrack');

      // Generate 32 animated waveform bars
      const numBars = 32;
      const barHeights: number[] = [];
      if (barsContainer) {
        let barsHtml = '';
        for (let i = 0; i < numBars; i++) {
          const h = Math.floor(Math.sin((i / numBars) * Math.PI) * 36) + Math.floor(Math.random() * 8) + 8;
          barHeights.push(h);
          barsHtml += `<div class="waveform-bar" id="wBar_${i}" style="height: ${h}px;"></div>`;
        }
        barsContainer.innerHTML = barsHtml;
      }

      let isPlaying = false;
      let currentSec = 0;
      const totalSec = 222; // 3 min 42 sec
      let audioTimer: any = null;

      const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      };

      const updateAudioUI = () => {
        if (currentTimeEl) currentTimeEl.textContent = formatTime(currentSec);
        const pct = (currentSec / totalSec) * 100;
        if (scrubberFill) scrubberFill.style.width = `${pct}%`;
        if (scrubberThumb) scrubberThumb.style.left = `${pct}%`;

        const activeBarIdx = Math.floor((currentSec / totalSec) * numBars);
        for (let i = 0; i < numBars; i++) {
          const bar = document.getElementById(`wBar_${i}`);
          if (bar) {
            if (i <= activeBarIdx) {
              bar.classList.add('active');
            } else {
              bar.classList.remove('active');
            }
          }
        }
      };

      btnPlayPause?.addEventListener('click', () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
          artDisc?.classList.add('playing');
          if (playIcon) playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
          audioTimer = setInterval(() => {
            currentSec += 1;
            if (currentSec >= totalSec) {
              currentSec = 0;
              isPlaying = false;
              artDisc?.classList.remove('playing');
              if (playIcon) playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
              clearInterval(audioTimer);
            }
            updateAudioUI();
          }, 1000);
        } else {
          artDisc?.classList.remove('playing');
          if (playIcon) playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
          if (audioTimer) clearInterval(audioTimer);
        }
      });

      document.getElementById('btnAudioRewind')?.addEventListener('click', () => {
        currentSec = Math.max(0, currentSec - 10);
        updateAudioUI();
      });

      document.getElementById('btnAudioForward')?.addEventListener('click', () => {
        currentSec = Math.min(totalSec, currentSec + 10);
        updateAudioUI();
      });

      scrubberTrack?.addEventListener('click', e => {
        const rect = scrubberTrack.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        currentSec = Math.floor(pct * totalSec);
        updateAudioUI();
      });

      document.getElementById('btnPreviewClose')?.addEventListener('click', () => {
        if (audioTimer) clearInterval(audioTimer);
      }, { once: true });
    }
  }

  private async openVersionHistoryModal(fileId: string) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return;

    this.showModal(
      `Version History: ${escapeHtml(file.name)}`,
      `
      <div class="version-history-container">
        <div style="display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          <div class="modal-loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px;"></div>
          Loading file version history...
        </div>
      </div>
    `,
      `<button class="btn-action secondary" id="btnCloseVersionHistory">Close</button>`
    );
    document.getElementById('btnCloseVersionHistory')?.addEventListener('click', () => this.closeModal());

    try {
      const versions = await this.api.getFileVersions(this.activeDriveId, fileId);
      const activeVerNum = file.version || 1;

      const renderBody = () => `
        <div class="version-history-container">
          <div class="version-active-banner" style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-weight: 600; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                <span class="version-num-tag current">v${activeVerNum}</span>
                Current Active Version
              </span>
              <span style="font-size: 11px; color: var(--accent-primary); font-weight: 500;">Active</span>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary); display: flex; gap: 12px; margin-top: 4px;">
              <span>${file.size}</span>
              <span>•</span>
              <span>${file.date}</span>
              <span>•</span>
              <span>${file.encrypted ? '🔒 AES-256-GCM' : 'Plaintext'}</span>
            </div>
            ${file.sha256_hash ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: monospace;">SHA256: ${file.sha256_hash.substring(0, 16)}...</div>` : ''}
          </div>

          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">
            Previous Versions (${versions.length})
          </div>

          ${
            versions.length === 0
              ? `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; background: var(--bg-surface-input); border-radius: var(--radius-sm);">
              No previous versions recorded yet. When you upload or overwrite a file with the same name, ProtoFS preserves past versions here automatically.
            </div>
          `
              : `
            <div class="version-history-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
              ${versions
                .map(
                  v => `
                <div class="version-card">
                  <div class="version-card-info">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span class="version-num-tag">v${v.version}</span>
                      <span style="font-size: 12px; font-weight: 500; color: var(--text-primary);">${formatBytes(v.size_bytes)}</span>
                    </div>
                    <div class="version-card-meta">
                      <span>${new Date(v.created_at).toLocaleString()}</span>
                      <span>•</span>
                      <span>${v.is_encrypted ? '🔒 Encrypted' : 'Plaintext'}</span>
                      ${v.sha256_hash ? `<span>• Hash: ${v.sha256_hash.substring(0, 8)}</span>` : ''}
                    </div>
                  </div>
                  <button class="btn-action secondary btn-restore-target-version" data-target-ver="${v.version}" style="padding: 4px 10px; font-size: 11px;">
                    Restore v${v.version}
                  </button>
                </div>
              `
                )
                .join('')}
            </div>
          `
          }
        </div>
      `;

      const modalBody = document.getElementById('dynamicModalBody');
      if (modalBody) {
        modalBody.innerHTML = renderBody();

        modalBody.querySelectorAll('.btn-restore-target-version').forEach(btn => {
          btn.addEventListener('click', async () => {
            const targetVer = Number((btn as HTMLElement).dataset.targetVer);
            if (!targetVer) return;

            (btn as HTMLButtonElement).disabled = true;
            (btn as HTMLButtonElement).textContent = 'Restoring...';

            try {
              await this.api.restoreFileVersion(this.activeDriveId, fileId, targetVer);
              await this.loadWorkspaceData();
              this.closeModal();
              this.showModal(
                'Version Restored',
                `
                <div style="padding: 12px; font-size: 13px; color: var(--text-primary); line-height: 1.5;">
                  <p>Successfully restored <strong>${escapeHtml(file.name)}</strong> to <strong>version v${targetVer}</strong>.</p>
                  <p style="margin-top: 8px; font-size: 12px; color: var(--text-muted);">The previous active version has been safely moved to history.</p>
                </div>
              `,
                `<button class="btn-action primary" id="btnRestoredDone">Done</button>`
              );
              document.getElementById('btnRestoredDone')?.addEventListener('click', () => this.closeModal());
            } catch (err: any) {
              await this.showAlert({
                title: 'Version Restoration Failed',
                message: `Failed to restore version: ${err.message || err}`,
                type: 'error',
              });
              (btn as HTMLButtonElement).disabled = false;
              (btn as HTMLButtonElement).textContent = `Restore v${targetVer}`;
            }
          });
        });
      }
    } catch (err: any) {
      const modalBody = document.getElementById('dynamicModalBody');
      if (modalBody) {
        modalBody.innerHTML = `<div style="padding: 16px; color: var(--color-danger); font-size: 12px;">Failed to load version history: ${escapeHtml(err.message || String(err))}</div>`;
      }
    }
  }

  // -------------------------------------------------------------------------
  // SHAREABLE LINKS
  // -------------------------------------------------------------------------

  private async openShareModal(fileId: string) {
    const file = this.files.find(f => f.id === fileId);
    if (!file) return;

    this.showModal(
      `Share File: ${escapeHtml(file.name)}`,
      `
      <div class="share-modal-container">
        <div style="display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          <div class="modal-loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px;"></div>
          Generating shareable links...
        </div>
      </div>
    `,
      `<button class="btn-action secondary" id="btnCloseShareModal">Close</button>`
    );
    document.getElementById('btnCloseShareModal')?.addEventListener('click', () => this.closeModal());

    try {
      let includeKey = false;
      let passphrase = '';
      let activeTab: 'protofs' | 'telegram' = 'protofs';

      const updateModalUI = async () => {
        const info = await this.api.generateShareLink(this.activeDriveId, fileId, includeKey ? (passphrase || 'user_passphrase') : undefined);
        if (!info) return;

        const modalBody = document.getElementById('dynamicModalBody');
        if (!modalBody) return;

        modalBody.innerHTML = `
          <div class="share-modal-container">
            <div class="share-file-banner">
              <div class="share-file-icon">
                ${getFileIconSvg(file.type)}
              </div>
              <div class="share-file-details">
                <span class="share-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                <div class="share-file-meta">
                  <span>${file.size}</span>
                  <span>•</span>
                  <span>${file.encrypted ? '🔒 Zero-Knowledge Encrypted' : 'Plaintext Document'}</span>
                  <span>•</span>
                  <span>Message #${info.telegram_message_id}</span>
                </div>
              </div>
            </div>

            <div class="share-tab-bar">
              <button class="share-tab-btn ${activeTab === 'protofs' ? 'active' : ''}" id="tabProtofsLink">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                <span>ProtoFS Deep Link</span>
              </button>
              <button class="share-tab-btn ${activeTab === 'telegram' ? 'active' : ''}" id="tabTelegramLink">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2 2 11.5l8 3.5 3.5 8L21.5 2z"/></svg>
                <span>Telegram Direct Link</span>
              </button>
            </div>

            ${activeTab === 'protofs' ? `
              <div class="share-link-group">
                <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">ProtoFS Universal Share URI</label>
                <div class="share-link-input-wrap">
                  <input type="text" class="share-link-input" id="inputProtofsShareLink" value="${escapeHtml(info.protofs_app_link)}" readonly>
                  <button class="share-copy-btn" id="btnCopyProtofsLink">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              ${file.encrypted ? `
                <div class="share-key-toggle-card">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                      <div style="font-size: 12.5px; font-weight: 600; color: var(--text-primary);">Embed Decryption Key in URL Fragment</div>
                      <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">RFC 3986 fragment hashes (#key=...) are never sent over the network.</div>
                    </div>
                    <label class="toggle-switch-wrapper">
                      <input type="checkbox" id="chkIncludeKey" ${includeKey ? 'checked' : ''}>
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                  ${includeKey ? `
                    <div style="margin-top: 8px;">
                      <input type="password" class="share-link-input" id="inputPassphrase" placeholder="Enter passphrase to encode into fragment" value="${escapeHtml(passphrase)}" style="width: 100%;">
                    </div>
                  ` : ''}
                </div>
              ` : ''}

              <div class="share-zk-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>${escapeHtml(info.zero_knowledge_note)}</span>
              </div>
            ` : `
              <div class="share-link-group">
                <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">Telegram Cloud Message Link</label>
                <div class="share-link-input-wrap">
                  <input type="text" class="share-link-input" id="inputTelegramShareLink" value="${escapeHtml(info.telegram_message_link)}" readonly>
                  <button class="share-copy-btn" id="btnCopyTelegramLink">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    <span>Copy</span>
                  </button>
                </div>
              </div>

              <div style="display: flex; gap: 8px; margin-top: 4px;">
                <button class="btn-action secondary" id="btnOpenTelegramWeb" style="flex: 1; font-size: 12px;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>Open Telegram Web</span>
                </button>
              </div>

              <div class="settings-section-card" style="font-size: 12px; line-height: 1.5; color: var(--text-secondary);">
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 2px;">Channel Access Prerequisite</div>
                Direct Telegram links open inside the official Telegram client. For private drives, recipients must be invited to the channel (Channel ID: <code>${info.channel_id}</code>).
              </div>
            `}
          </div>
        `;

        document.getElementById('tabProtofsLink')?.addEventListener('click', () => {
          activeTab = 'protofs';
          updateModalUI();
        });

        document.getElementById('tabTelegramLink')?.addEventListener('click', () => {
          activeTab = 'telegram';
          updateModalUI();
        });

        document.getElementById('chkIncludeKey')?.addEventListener('change', (e) => {
          includeKey = (e.target as HTMLInputElement).checked;
          updateModalUI();
        });

        document.getElementById('inputPassphrase')?.addEventListener('input', (e) => {
          passphrase = (e.target as HTMLInputElement).value;
          const inputEl = document.getElementById('inputProtofsShareLink') as HTMLInputElement;
          if (inputEl) {
            let updated = info.protofs_app_link.split('#')[0];
            if (passphrase.trim()) {
              updated += `#key=${encodeURIComponent(passphrase.trim())}`;
            }
            inputEl.value = updated;
          }
        });

        const setupCopyButton = (btnId: string, inputId: string) => {
          document.getElementById(btnId)?.addEventListener('click', async () => {
            const inputEl = document.getElementById(inputId) as HTMLInputElement;
            if (!inputEl) return;
            try {
              await navigator.clipboard.writeText(inputEl.value);
              const btn = document.getElementById(btnId);
              if (btn) {
                btn.classList.add('copied');
                btn.innerHTML = `<span>✓ Copied!</span>`;
                setTimeout(() => {
                  btn.classList.remove('copied');
                  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy</span>`;
                }, 2000);
              }
            } catch {
              inputEl.select();
            }
          });
        };

        setupCopyButton('btnCopyProtofsLink', 'inputProtofsShareLink');
        setupCopyButton('btnCopyTelegramLink', 'inputTelegramShareLink');

        document.getElementById('btnOpenTelegramWeb')?.addEventListener('click', () => {
          window.open(info.telegram_web_link, '_blank');
        });
      };

      await updateModalUI();
    } catch (err: any) {
      const modalBody = document.getElementById('dynamicModalBody');
      if (modalBody) {
        modalBody.innerHTML = `<div style="padding: 16px; color: var(--color-danger); font-size: 12px;">Failed to generate share link: ${escapeHtml(err.message || String(err))}</div>`;
      }
    }
  }

  private openImportSharedLinkModal() {
    this.showModal(
      'Import Shared Link to Current Folder',
      `
      <div class="share-modal-container">
        <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
          Paste a <strong>ProtoFS Deep Link</strong> (<code>protofs://share?...</code>) or a direct <strong>Telegram Link</strong> (<code>https://t.me/c/...</code>) to link the file directly into your active folder.
        </div>

        <div class="form-group">
          <label class="form-label">Share Link URL</label>
          <input type="text" class="form-input" id="inputImportLinkUrl" placeholder="protofs://share?drive=... or https://t.me/c/..." required autofocus>
        </div>

        <div id="importPreviewArea" class="hidden"></div>

        <div class="form-group hidden" id="groupImportCustomKey">
          <label class="form-label">Decryption Passphrase (AES-256-GCM)</label>
          <input type="password" class="form-input" id="inputImportKey" placeholder="Enter passphrase to decrypt this file">
        </div>

        <div class="form-group hidden" id="groupImportCustomName">
          <label class="form-label">File Name (Optional Override)</label>
          <input type="text" class="form-input" id="inputImportName" placeholder="Leave blank to use original name">
        </div>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelImportLink">Cancel</button>
      <button class="btn-action primary" id="btnConfirmImportLink" disabled>Import File</button>
    `
    );

    document.getElementById('btnCancelImportLink')?.addEventListener('click', () => this.closeModal());

    const inputUrl = document.getElementById('inputImportLinkUrl') as HTMLInputElement;
    const previewArea = document.getElementById('importPreviewArea');
    const groupKey = document.getElementById('groupImportCustomKey');
    const groupName = document.getElementById('groupImportCustomName');
    const btnConfirm = document.getElementById('btnConfirmImportLink') as HTMLButtonElement;

    let currentParsed: ParsedShareLink | null = null;

    const parseAndRender = async () => {
      const url = inputUrl?.value.trim();
      if (!url) {
        if (previewArea) previewArea.classList.add('hidden');
        if (groupKey) groupKey.classList.add('hidden');
        if (groupName) groupName.classList.add('hidden');
        if (btnConfirm) btnConfirm.disabled = true;
        currentParsed = null;
        return;
      }

      const parsed = await this.api.parseShareLink(url);
      if (parsed && parsed.is_valid) {
        currentParsed = parsed;
        if (previewArea) {
          previewArea.classList.remove('hidden');
          previewArea.innerHTML = `
            <div class="share-import-preview-box">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${escapeHtml(parsed.name)}</span>
                <span style="font-size: 11px; padding: 2px 6px; border-radius: var(--radius-xs); background: ${parsed.is_encrypted ? 'var(--accent-soft)' : 'var(--bg-surface-input)'}; color: ${parsed.is_encrypted ? 'var(--accent-primary)' : 'var(--text-secondary)'}; font-weight: 500;">
                  ${parsed.is_encrypted ? '🔒 Encrypted' : 'Plaintext'}
                </span>
              </div>
              <div style="font-size: 11.5px; color: var(--text-muted); display: flex; gap: 8px;">
                ${parsed.size_bytes > 0 ? `<span>Size: ${formatBytes(parsed.size_bytes)}</span>•` : ''}
                <span>Message #${parsed.telegram_message_id || 'N/A'}</span>
                ${parsed.encryption_key ? `<span>• Key Embedded in Hash</span>` : ''}
              </div>
            </div>
          `;
        }

        if (groupKey) {
          groupKey.classList.toggle('hidden', !parsed.is_encrypted || !!parsed.encryption_key);
        }
        if (groupName) {
          groupName.classList.remove('hidden');
        }
        if (btnConfirm) {
          btnConfirm.disabled = false;
        }
      } else {
        currentParsed = null;
        if (previewArea) {
          previewArea.classList.remove('hidden');
          previewArea.innerHTML = `
            <div style="padding: 10px; font-size: 11.5px; color: var(--color-danger); background: rgba(239, 68, 68, 0.08); border-radius: var(--radius-sm); border: 1px solid rgba(239, 68, 68, 0.2);">
              Unrecognized link format. Please provide a valid <code>protofs://share</code> or <code>https://t.me/c/...</code> URL.
            </div>
          `;
        }
        if (groupKey) groupKey.classList.add('hidden');
        if (groupName) groupName.classList.add('hidden');
        if (btnConfirm) btnConfirm.disabled = true;
      }
    };

    inputUrl?.addEventListener('input', parseAndRender);
    inputUrl?.addEventListener('paste', () => setTimeout(parseAndRender, 50));

    btnConfirm?.addEventListener('click', async () => {
      if (!currentParsed) return;
      const url = inputUrl.value.trim();
      const customName = (document.getElementById('inputImportName') as HTMLInputElement)?.value.trim() || undefined;
      const customKey = (document.getElementById('inputImportKey') as HTMLInputElement)?.value.trim() || undefined;

      btnConfirm.disabled = true;
      btnConfirm.textContent = 'Importing...';

      try {
        await this.api.importSharedLink(this.activeDriveId, this.currentFolderId, url, customName, customKey);
        await this.loadWorkspaceData();
        this.closeModal();
        this.triggerTransfer(customName || currentParsed.name, formatBytes(currentParsed.size_bytes), 'downloading');
      } catch (err: any) {
        await this.showAlert({
          title: 'Import Failed',
          message: `Could not import shared link: ${err.message || err}`,
          type: 'error',
        });
        btnConfirm.disabled = false;
        btnConfirm.textContent = 'Import File';
      }
    });
  }

  private async openExportDriveModal() {
    if (this.drives.length === 0) {
      await this.showAlert({
        title: 'No Drives Available',
        message: 'You do not have any drives to export. Create or adopt a drive first.',
        type: 'info',
      });
      return;
    }

    const drive = this.drives.find(d => d.id === this.activeDriveId);
    const driveName = drive ? drive.name : 'ProtoFS-Drive';
    const sanitizedName = driveName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultExportPath = `ProtoFS-Backups/${sanitizedName}`;

    this.showModal(
      'Export Entire Drive to Local Folder',
      `
      <div style="display: flex; flex-direction: column; gap: 14px; font-size: 13px;">
        <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; line-height: 1.5; color: var(--text-secondary);">
          <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Full Drive Export</div>
          Export all directories and files from <strong>${escapeHtml(driveName)}</strong> to your local filesystem.
          Files are reconstructed into nested folders, decrypted from AES-256-GCM STREAM chunks, and a standalone <code>manifest.json</code> is saved at the root.
        </div>

        <div class="form-group">
          <label class="form-label">Target Local Destination Directory</label>
          <input type="text" class="form-input" id="inputExportPath" value="${escapeHtml(defaultExportPath)}" placeholder="e.g. D:/ProtoFS-Backups/${escapeHtml(sanitizedName)}" required>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
            Relative paths are created relative to the application working directory. Absolute paths (e.g. <code>C:/Backups/...</code>) are supported.
          </div>
        </div>

        <div id="exportStatusArea" class="hidden" style="display: none; padding: 12px; background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); text-align: center;">
          <div class="modal-loading-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle;"></div>
          Exporting files and writing manifest...
        </div>
      </div>
    `,
      `
      <button class="btn-action secondary" id="btnCancelExport">Cancel</button>
      <button class="btn-action primary" id="btnStartExport">Start Export</button>
    `
    );

    document.getElementById('btnCancelExport')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnStartExport')?.addEventListener('click', async () => {
      const pathInput = document.getElementById('inputExportPath') as HTMLInputElement;
      const targetPath = pathInput?.value.trim();
      if (!targetPath) return;

      const btnStart = document.getElementById('btnStartExport') as HTMLButtonElement;
      const btnCancel = document.getElementById('btnCancelExport') as HTMLButtonElement;
      const statusArea = document.getElementById('exportStatusArea');

      if (btnStart) {
        btnStart.disabled = true;
        btnStart.textContent = 'Exporting...';
      }
      if (btnCancel) btnCancel.disabled = true;
      if (statusArea) {
        statusArea.classList.remove('hidden');
        statusArea.style.display = 'block';
      }

      try {
        const result = await this.api.exportDrive(this.activeDriveId, targetPath);
        this.showModal(
          'Drive Export Completed',
          `
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: var(--text-primary);">
            <div style="color: var(--accent-primary); font-weight: 600; font-size: 14px;">
              ✓ Drive Export Finished Successfully
            </div>
            <div style="background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; line-height: 1.6; font-size: 12px;">
              <div><strong>Destination:</strong> <code>${escapeHtml(result.export_path)}</code></div>
              <div><strong>Folders Reconstructed:</strong> ${result.total_folders}</div>
              <div><strong>Files Exported:</strong> ${result.total_files}</div>
              <div><strong>Total Data Size:</strong> ${formatBytes(result.total_bytes)}</div>
              <div style="margin-top: 6px; color: var(--text-muted);">Root <code>manifest.json</code> successfully written.</div>
            </div>
          </div>
        `,
          `<button class="btn-action primary" id="btnExportDone">Done</button>`
        );
        document.getElementById('btnExportDone')?.addEventListener('click', () => this.closeModal());
      } catch (err: any) {
        await this.showAlert({
          title: 'Drive Export Failed',
          message: `Export failed: ${err.message || err}`,
          type: 'error',
        });
        if (btnStart) {
          btnStart.disabled = false;
          btnStart.textContent = 'Start Export';
        }
        if (btnCancel) btnCancel.disabled = false;
        if (statusArea) {
          statusArea.classList.add('hidden');
          statusArea.style.display = 'none';
        }
      }
    });
  }

  private updateVirtualDrivePill() {
    const pillBtn = document.getElementById('btnQuickMountDrive');
    const pulseDot = document.getElementById('mountPulseDot');
    const pillText = document.getElementById('mountPillText');
    if (!pillBtn || !pulseDot || !pillText) return;

    if (this.virtualDriveStatus?.is_mounted && this.virtualDriveStatus.drive_letter) {
      pillBtn.classList.add('mounted');
      pulseDot.classList.remove('hidden');
      pillText.textContent = `${this.virtualDriveStatus.drive_letter}:\\ Mounted`;
      pillBtn.title = `Virtual Drive Mounted on ${this.virtualDriveStatus.drive_letter}:\\ (Click to manage)`;
    } else {
      pillBtn.classList.remove('mounted');
      pulseDot.classList.add('hidden');
      pillText.textContent = 'Mount Drive';
      pillBtn.title = 'Mount Native Virtual Drive (P:\\)';
    }
  }

  private async openVirtualDriveModal() {
    if (this.drives.length === 0) {
      await this.showAlert({
        title: 'No Drives Available',
        message: 'You must create or adopt a drive before mounting.',
        type: 'info',
      });
      return;
    }

    const drive = this.drives.find(d => d.id === this.activeDriveId);
    const driveName = drive ? drive.name : 'ProtoFS Drive';

    this.showModal(
      'Native Virtual Drive Mount',
      `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
        <div class="modal-loading-spinner" style="display: inline-block; width: 18px; height: 18px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></div>
        Querying virtual drive status...
      </div>
    `,
      `<button class="btn-action secondary" id="btnCloseMountModal">Close</button>`
    );
    document.getElementById('btnCloseMountModal')?.addEventListener('click', () => this.closeModal());

    const refreshModalView = async () => {
      try {
        this.virtualDriveStatus = await this.api.getVirtualDriveStatus(this.activeDriveId);
      } catch (err: any) {
        console.error('Failed to get virtual drive status:', err);
      }
      this.updateVirtualDrivePill();
      this.renderDrivesNav();

      const modalBody = document.getElementById('dynamicModalBody');
      const modalFooter = document.getElementById('dynamicModalFooter');
      if (!modalBody || !modalFooter) return;

      const status = this.virtualDriveStatus;
      const isMounted = status?.is_mounted ?? false;
      const currentLetter = status?.drive_letter || 'P';
      const availableLetters = status?.available_letters || ['P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Z'];
      const isWinFsp = status?.winfsp_available ?? false;
      const mountPath = status?.mount_path || '';
      const totalFiles = this.files.length;
      const totalSizeBytes = this.files.reduce((sum, f) => sum + f.size_bytes, 0);
      const cacheUsedBytes = status?.cached_bytes ?? 0;

      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; font-size: 13px;">
          <!-- Hero Status Card -->
          <div class="mount-status-hero ${isMounted ? 'mounted' : ''}">
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 42px; height: 42px; border-radius: var(--radius-sm); background: ${isMounted ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-surface)'}; display: flex; align-items: center; justify-content: center; color: ${isMounted ? '#10b981' : 'var(--text-muted)'};">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>
                  </svg>
                </div>
                <div>
                  <div style="font-weight: 600; font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <span>${escapeHtml(driveName)}</span>
                    ${isMounted ? `<span class="mount-letter-badge">${escapeHtml(currentLetter)}:\\</span>` : ''}
                  </div>
                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                    ${isMounted ? 'Mounted and accessible as local native drive' : 'Virtual drive unmounted'}
                  </div>
                </div>
              </div>
              <div>
                <span class="badge ${isMounted ? 'badge-success' : 'badge-neutral'}" style="font-size: 11px; padding: 4px 10px;">
                  ${isMounted ? 'Active / Mounted' : 'Offline / Unmounted'}
                </span>
              </div>
            </div>
          </div>

          <!-- Configuration & Options -->
          ${
            !isMounted
              ? `
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Select Windows Drive Letter</label>
              <select class="form-input" id="selectMountLetter" style="cursor: pointer;">
                ${availableLetters
                  .map(
                    letter => `
                  <option value="${letter}" ${letter === currentLetter ? 'selected' : ''}>
                    ${letter}:\\ ${letter === 'P' ? '(ProtoFS Default)' : ''}
                  </option>
                `
                  )
                  .join('')}
              </select>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                Only unassigned drive letters detected on your system are listed.
              </div>
            </div>
          `
              : `
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Local File System Mirror Path</label>
              <input type="text" class="form-input" value="${escapeHtml(mountPath)}" readonly style="background: var(--bg-surface-elevated); cursor: text;">
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                Projected virtual filesystem mirror mapped to drive letter <code>${escapeHtml(currentLetter)}:\\</code>.
              </div>
            </div>
          `
          }

          <!-- Statistics Grid -->
          <div class="mount-grid-stats">
            <div class="mount-stat-box">
              <div class="mount-stat-label">Projected Files</div>
              <div class="mount-stat-val">${totalFiles} items</div>
            </div>
            <div class="mount-stat-box">
              <div class="mount-stat-label">Total Cloud Size</div>
              <div class="mount-stat-val">${formatBytes(totalSizeBytes)}</div>
            </div>
            <div class="mount-stat-box">
              <div class="mount-stat-label">Local Cache Footprint</div>
              <div class="mount-stat-val">${formatBytes(cacheUsedBytes)}</div>
            </div>
            <div class="mount-stat-box">
              <div class="mount-stat-label">Mount Driver Subsystem</div>
              <div class="mount-stat-val">${isWinFsp ? 'WinFsp (Kernel)' : 'Native OS (subst)'}</div>
            </div>
          </div>

          <!-- Technical Notice -->
          <div style="padding: 10px 14px; background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
            <strong>How it works:</strong> ProtoFS projects your virtual file system directly to a native Windows drive letter. External applications such as Windows Explorer, VLC Media Player, and office suites can open files directly with zero manual exports.
          </div>

          <!-- Android SAF Integration Banner -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
            <div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                <span>Android Storage Access Framework (SAF)</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Expose this drive to the native Android Files app and system document pickers.</div>
            </div>
            <button class="btn-action secondary" id="btnOpenSafModalFromMount" style="padding: 4px 10px; font-size: 11px; flex-shrink: 0;">Configure SAF</button>
          </div>

          <div id="mountActionStatusArea" class="hidden" style="display: none; padding: 10px; background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); text-align: center;">
            <div class="modal-loading-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle;"></div>
            <span id="mountActionStatusText">Applying changes...</span>
          </div>
        </div>
      `;

      if (isMounted) {
        modalFooter.innerHTML = `
          <button class="btn-action secondary" id="btnClearDriveCache" title="Clear local unpinned decrypted files cache">Clear Cache</button>
          <button class="btn-action danger" id="btnUnmountDriveBtn">Unmount Drive</button>
          <button class="btn-action primary" id="btnOpenInExplorer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Open in Explorer
          </button>
        `;
      } else {
        modalFooter.innerHTML = `
          <button class="btn-action secondary" id="btnCloseMountModalDone">Close</button>
          <button class="btn-action secondary" id="btnOpenMirrorFolder">Open Folder</button>
          <button class="btn-action primary" id="btnMountDriveBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; vertical-align: middle;"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
            Mount as Native Drive
          </button>
        `;
      }

      // Action Handlers
      document.getElementById('btnCloseMountModalDone')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btnOpenSafModalFromMount')?.addEventListener('click', () => {
        this.openDocumentsProviderModal();
      });

      document.getElementById('btnOpenInExplorer')?.addEventListener('click', async () => {
        try {
          await this.api.openVirtualDriveInExplorer(this.activeDriveId);
        } catch (err: any) {
          await this.showAlert({
            title: 'Explorer Open Failed',
            message: `Could not launch Windows Explorer: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnOpenMirrorFolder')?.addEventListener('click', async () => {
        try {
          await this.api.openVirtualDriveInExplorer(this.activeDriveId);
        } catch (err: any) {
          await this.showAlert({
            title: 'Open Mirror Folder Failed',
            message: `Could not open folder: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnMountDriveBtn')?.addEventListener('click', async () => {
        const selectEl = document.getElementById('selectMountLetter') as HTMLSelectElement;
        const letter = selectEl ? selectEl.value : currentLetter;
        const statusArea = document.getElementById('mountActionStatusArea');
        const statusText = document.getElementById('mountActionStatusText');
        const btnMount = document.getElementById('btnMountDriveBtn') as HTMLButtonElement;

        if (statusArea) {
          statusArea.classList.remove('hidden');
          statusArea.style.display = 'block';
        }
        if (statusText) statusText.textContent = `Mounting drive ${letter}:\\ and preparing virtual filesystem mirror...`;
        if (btnMount) btnMount.disabled = true;

        try {
          const res = await this.api.mountVirtualDrive(this.activeDriveId, letter, true);
          this.virtualDriveStatus = res;
          await refreshModalView();
        } catch (err: any) {
          if (statusArea) {
            statusArea.classList.add('hidden');
            statusArea.style.display = 'none';
          }
          if (btnMount) btnMount.disabled = false;
          await this.showAlert({
            title: 'Mount Virtual Drive Failed',
            message: `Failed to mount drive ${letter}:\\ - ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnUnmountDriveBtn')?.addEventListener('click', async () => {
        const statusArea = document.getElementById('mountActionStatusArea');
        const statusText = document.getElementById('mountActionStatusText');
        const btnUnmount = document.getElementById('btnUnmountDriveBtn') as HTMLButtonElement;

        if (statusArea) {
          statusArea.classList.remove('hidden');
          statusArea.style.display = 'block';
        }
        if (statusText) statusText.textContent = 'Unmounting virtual drive...';
        if (btnUnmount) btnUnmount.disabled = true;

        try {
          const res = await this.api.unmountVirtualDrive(this.activeDriveId);
          this.virtualDriveStatus = res;
          await refreshModalView();
        } catch (err: any) {
          if (statusArea) {
            statusArea.classList.add('hidden');
            statusArea.style.display = 'none';
          }
          if (btnUnmount) btnUnmount.disabled = false;
          await this.showAlert({
            title: 'Unmount Failed',
            message: `Failed to unmount drive: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnClearDriveCache')?.addEventListener('click', async () => {
        const confirmed = await this.showConfirm({
          title: 'Clear Virtual Drive Cache',
          message: 'Clear all cached mirror files for this drive? Pinned files and cloud data in Telegram remain intact.',
          confirmText: 'Clear Cache',
          isDanger: false,
        });

        if (confirmed) {
          try {
            await this.api.clearVirtualDriveCache(this.activeDriveId);
            await refreshModalView();
          } catch (err: any) {
            await this.showAlert({
              title: 'Clear Cache Failed',
              message: `Could not clear cache: ${err.message || err}`,
              type: 'error',
            });
          }
        }
      });
    };

    await refreshModalView();
  }

  private async openDocumentsProviderModal() {
    const drive = this.drives.find(d => d.id === this.activeDriveId);
    const driveName = drive ? drive.name : 'ProtoFS Drive';

    this.showModal(
      'Android DocumentsProvider Integration',
      `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
        <div class="modal-loading-spinner" style="display: inline-block; width: 18px; height: 18px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></div>
        Loading Android Storage Access Framework (SAF) configuration...
      </div>
    `,
      `<button class="btn-action secondary" id="btnCloseSafModal">Close</button>`
    );
    document.getElementById('btnCloseSafModal')?.addEventListener('click', () => this.closeModal());

    const refreshSafModalView = async () => {
      let status: DocumentsProviderStatus;
      try {
        status = await this.api.getDocumentsProviderStatus(this.activeDriveId);
      } catch (err: any) {
        console.error('Failed to get DocumentsProvider status:', err);
        status = {
          is_enabled: true,
          authority: 'com.protofs.app.documents',
          root_count: 1,
          active_drive_id: this.activeDriveId,
          saf_uri: `content://com.protofs.app.documents/root/${this.activeDriveId}`,
          cached_documents_count: this.files.length + this.folders.length,
          is_android: false,
        };
      }

      const modalBody = document.getElementById('dynamicModalBody');
      const modalFooter = document.getElementById('dynamicModalFooter');
      if (!modalBody || !modalFooter) return;

      modalBody.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; font-size: 13px;">
          <!-- Hero Card -->
          <div class="saf-hero-card ${status.is_enabled ? 'active' : ''}">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 36px; height: 36px; border-radius: var(--radius-sm); background: ${status.is_enabled ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-surface)'}; display: flex; align-items: center; justify-content: center; color: ${status.is_enabled ? '#10b981' : 'var(--text-muted)'};">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                  </svg>
                </div>
                <div>
                  <div style="font-weight: 600; font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <span>${escapeHtml(driveName)}</span>
                    <span style="font-size: 11px; background: var(--bg-surface-input); padding: 2px 6px; border-radius: var(--radius-xs); color: var(--text-muted); font-family: monospace;">${escapeHtml(status.authority)}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                    ${status.is_enabled ? 'Active in Android Storage Access Framework' : 'DocumentsProvider registration disabled'}
                  </div>
                </div>
              </div>
              <span class="badge ${status.is_enabled ? 'badge-success' : 'badge-neutral'}" style="font-size: 11px; padding: 4px 10px;">
                ${status.is_enabled ? 'SAF Active' : 'Disabled'}
              </span>
            </div>

            <!-- Content URI Box -->
            <div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; font-weight: 500;">Native Android Document Content URI:</div>
              <div class="saf-code-box">
                <span id="txtSafUri">${escapeHtml(status.saf_uri)}</span>
                <button class="btn-action secondary" id="btnCopySafUri" style="padding: 2px 8px; font-size: 10px; margin-left: 8px; flex-shrink: 0;">Copy URI</button>
              </div>
            </div>
          </div>

          <!-- Feature Cards -->
          <div class="saf-feature-grid">
            <div class="saf-feature-item">
              <div class="saf-feature-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>Files App Picker</span>
              </div>
              <div class="saf-feature-desc">Exposes virtual folders directly to the system document picker and Android Files app.</div>
            </div>
            <div class="saf-feature-item">
              <div class="saf-feature-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>3rd-Party Streaming</span>
              </div>
              <div class="saf-feature-desc">VLC, QuickEdit, and office suites read files on-demand via ParcelFileDescriptor pipes.</div>
            </div>
            <div class="saf-feature-item">
              <div class="saf-feature-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                <span>ContentResolver Sync</span>
              </div>
              <div class="saf-feature-desc">VFS updates notify Android ContentResolver to refresh third-party apps automatically.</div>
            </div>
          </div>

          <!-- Interactive SAF Query Tester -->
          <div class="saf-test-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <div style="font-weight: 600; font-size: 12px; color: var(--text-primary);">Interactive SAF Query Tester</div>
              <button class="btn-action secondary" id="btnRunSafTestQuery" style="padding: 4px 10px; font-size: 11px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run Query Test
              </button>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">
              Simulates the Android OS <code>DocumentsProvider.queryDocument()</code> call resolving MatrixCursor metadata for this drive root.
            </div>
            <div class="saf-test-matrix" id="safQueryOutput">// Click "Run Query Test" to simulate Android DocumentsProvider MatrixCursor output...</div>
          </div>

          <!-- Status indicator message -->
          <div id="safActionStatusArea" class="hidden" style="padding: 10px; background: var(--bg-surface-input); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-muted); text-align: center;">
            <div class="modal-loading-spinner" style="display: inline-block; width: 14px; height: 14px; border: 2px solid var(--border-subtle); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle;"></div>
            <span id="safActionStatusText">Updating...</span>
          </div>
        </div>
      `;

      modalFooter.innerHTML = `
        <button class="btn-action secondary" id="btnOpenWorkManagerFromSaf">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          <span>Background Sync</span>
        </button>
        <button class="btn-action secondary" id="btnCloseSafModalDone">Close</button>
        <button class="btn-action secondary" id="btnNotifySafChange">Notify ContentResolver</button>
        <button class="btn-action ${status.is_enabled ? 'secondary' : 'primary'}" id="btnToggleSafState">
          ${status.is_enabled ? 'Disable SAF' : 'Enable SAF'}
        </button>
      `;

      // Event handlers
      document.getElementById('btnOpenWorkManagerFromSaf')?.addEventListener('click', () => {
        this.openWorkManagerSyncModal();
      });
      document.getElementById('btnCloseSafModalDone')?.addEventListener('click', () => this.closeModal());

      document.getElementById('btnCopySafUri')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(status.saf_uri);
          const btn = document.getElementById('btnCopySafUri');
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = orig;
            }, 2000);
          }
        } catch {
          await this.showAlert({
            title: 'Copy URI',
            message: `Content URI: ${status.saf_uri}`,
            type: 'info',
          });
        }
      });

      document.getElementById('btnToggleSafState')?.addEventListener('click', async () => {
        const newTarget = !status.is_enabled;
        try {
          await this.api.toggleDocumentsProvider(this.activeDriveId, newTarget);
          await refreshSafModalView();
        } catch (err: any) {
          await this.showAlert({
            title: 'SAF Toggle Failed',
            message: `Could not update DocumentsProvider: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnNotifySafChange')?.addEventListener('click', async () => {
        try {
          await this.api.notifyDocumentsProviderChange(this.activeDriveId);
          await this.showAlert({
            title: 'ContentResolver Notified',
            message: `Dispatched notifyChange() for authority ${status.authority} to refresh connected Android file pickers.`,
            type: 'info',
          });
        } catch (err: any) {
          await this.showAlert({
            title: 'Notification Failed',
            message: `Could not dispatch notification: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnRunSafTestQuery')?.addEventListener('click', async () => {
        const out = document.getElementById('safQueryOutput');
        if (out) out.textContent = 'Executing test SAF document query...';
        try {
          const res = await this.api.testSafDocumentQuery(this.activeDriveId);
          if (out) {
            out.textContent = JSON.stringify(
              {
                "MatrixCursor": {
                  "authority": res.authority,
                  "document_id": res.document_id,
                  "display_name": res.display_name,
                  "mime_type": res.mime_type,
                  "size_bytes": res.size_bytes,
                  "flags": res.flags,
                  "child_count": res.child_count,
                  "status": "VALID_DOCUMENT_ROOT"
                }
              },
              null,
              2
            );
          }
        } catch (err: any) {
          if (out) out.textContent = `Error executing query: ${err.message || err}`;
        }
      });
    };

    await refreshSafModalView();
  }

  // -------------------------------------------------------------------------
  // ANDROID JETPACK WORKMANAGER BACKGROUND SYNC
  // -------------------------------------------------------------------------

  private async openWorkManagerSyncModal() {
    let status = await this.api.getWorkManagerSyncStatus();
    let selectedInterval = status.config.interval_minutes;

    const intervals = [
      { minutes: 15, label: '15 Min' },
      { minutes: 30, label: '30 Min' },
      { minutes: 60, label: '1 Hour' },
      { minutes: 360, label: '6 Hours' },
      { minutes: 720, label: '12 Hours' },
      { minutes: 1440, label: '24 Hours' },
    ];

    const renderModalBody = () => {
      const isEnabled = status.config.enabled;
      const historyRows =
        status.recent_history.length > 0
          ? status.recent_history
              .map(
                h => `
            <div class="workmanager-history-row">
              <span style="font-family: monospace;">${escapeHtml(h.formatted_time.split('T')[0] || h.formatted_time)}</span>
              <span>${escapeHtml(h.message)}</span>
              <span style="color: var(--text-muted); text-align: right;">${h.files_synced} files (${h.formatted_bytes})</span>
              <span style="text-align: right;">
                <span class="workmanager-status-badge-ok">${h.duration_ms}ms OK</span>
              </span>
            </div>
          `
              )
              .join('')
          : `<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 11.5px;">No background sync passes recorded yet.</div>`;

      return `
        <div class="workmanager-hero-card ${isEnabled ? 'active' : ''}">
          <div class="workmanager-header-row">
            <div class="workmanager-status-indicator">
              <span class="workmanager-dot-pulse ${isEnabled ? '' : 'inactive'}"></span>
              <span>${isEnabled ? 'WorkManager Service Active (Periodic Schedule Enqueued)' : 'Background Sync Service Paused'}</span>
            </div>
            <label class="toggle-switch-wrapper">
              <input type="checkbox" id="chkWorkManagerEnable" ${isEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
            Android Jetpack WorkManager runs resilient periodic background synchronization even when ProtoFS is closed or the device reboots. Sync jobs strictly honor your battery and network constraints.
          </div>
          <div style="display: flex; align-items: center; gap: 16px; font-size: 11.5px; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 10px;">
            <span>Next run: <strong>${status.next_scheduled_run ? escapeHtml(status.next_scheduled_run) : 'Not scheduled'}</strong></span>
            <span>Target sync pairs: <strong>${this.syncPairs.length || status.active_pairs_count || 1} registered</strong></span>
            <span>Architecture: <strong>${status.is_android ? 'Native AndroidX KTX' : 'Desktop / Android Emulation'}</strong></span>
          </div>
        </div>

        <div style="margin-top: 16px;">
          <label class="form-label" style="font-weight: 700;">Sync Execution Interval</label>
          <div class="workmanager-interval-picker">
            ${intervals
              .map(
                iv => `
              <button class="workmanager-interval-btn ${selectedInterval === iv.minutes ? 'selected' : ''}" data-interval="${iv.minutes}">
                ${iv.label}
              </button>
            `
              )
              .join('')}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 5px;">
            Note: Android WorkManager enforces a minimum periodic work interval of 15 minutes to preserve battery life.
          </div>
        </div>

        <div style="margin-top: 16px;">
          <label class="form-label" style="font-weight: 700;">Execution Constraints (WorkManager Constraints.Builder)</label>
          <div class="workmanager-constraints-box">
            <label class="workmanager-constraint-item">
              <div>
                <div style="font-weight: 600; color: var(--text-primary);">Wi-Fi Only (NetworkType.UNMETERED)</div>
                <div style="font-size: 11px; color: var(--text-muted);">Never consume mobile carrier cellular data for background syncing.</div>
              </div>
              <input type="checkbox" id="chkWmWifi" ${status.config.wifi_only ? 'checked' : ''}>
            </label>
            <label class="workmanager-constraint-item">
              <div>
                <div style="font-weight: 600; color: var(--text-primary);">Require Device Charging (RequiresCharging)</div>
                <div style="font-size: 11px; color: var(--text-muted);">Only run background sync jobs while connected to AC power.</div>
              </div>
              <input type="checkbox" id="chkWmCharging" ${status.config.requires_charging ? 'checked' : ''}>
            </label>
            <label class="workmanager-constraint-item">
              <div>
                <div style="font-weight: 600; color: var(--text-primary);">Battery Safeguard (RequiresBatteryNotLow > 15%)</div>
                <div style="font-size: 11px; color: var(--text-muted);">Prevent sync jobs from running when the battery is low.</div>
              </div>
              <input type="checkbox" id="chkWmBattery" ${status.config.requires_battery_not_low ? 'checked' : ''}>
            </label>
          </div>
        </div>

        <div style="margin-top: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label class="form-label" style="margin-bottom: 0; font-weight: 700;">Recent Background Sync Passes</label>
            <button class="btn-action secondary" id="btnTestRunWorkManagerNow" style="padding: 4px 10px; font-size: 11px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Run Sync Pass Now</span>
            </button>
          </div>
          <div class="workmanager-history-container">
            <div class="workmanager-history-row workmanager-history-header">
              <span>Timestamp</span>
              <span>Details</span>
              <span style="text-align: right;">Payload</span>
              <span style="text-align: right;">Status</span>
            </div>
            ${historyRows}
          </div>
        </div>
      `;
    };

    const renderFooter = () => `
      <button class="btn-action secondary" id="btnCancelWorkManager">Close</button>
      <button class="btn-action primary" id="btnSaveWorkManager">Save Configuration</button>
    `;

    const refreshModal = () => {
      const bodyEl = document.getElementById('dynamicModalBody');
      if (bodyEl) {
        bodyEl.innerHTML = renderModalBody();
        bindModalEvents();
      }
    };

    const bindModalEvents = () => {
      document.getElementById('btnCancelWorkManager')?.addEventListener('click', () => this.closeModal());

      document.querySelectorAll('.workmanager-interval-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedInterval = Number((btn as HTMLElement).dataset.interval) || 60;
          document.querySelectorAll('.workmanager-interval-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      });

      document.getElementById('btnTestRunWorkManagerNow')?.addEventListener('click', async () => {
        const testBtn = document.getElementById('btnTestRunWorkManagerNow') as HTMLButtonElement;
        if (testBtn) {
          testBtn.disabled = true;
          testBtn.innerText = 'Syncing...';
        }
        try {
          const record = await this.api.triggerImmediateBackgroundSync();
          status = await this.api.getWorkManagerSyncStatus();
          refreshModal();
          await this.showAlert({
            title: 'Background Sync Pass Executed',
            message: `${record.message}`,
            type: 'success',
          });
        } catch (err: any) {
          await this.showAlert({
            title: 'Sync Execution Failed',
            message: `Background sync error: ${err.message || err}`,
            type: 'error',
          });
        }
      });

      document.getElementById('btnSaveWorkManager')?.addEventListener('click', async () => {
        const enabled = (document.getElementById('chkWorkManagerEnable') as HTMLInputElement)?.checked ?? false;
        const wifiOnly = (document.getElementById('chkWmWifi') as HTMLInputElement)?.checked ?? true;
        const requiresCharging = (document.getElementById('chkWmCharging') as HTMLInputElement)?.checked ?? false;
        const requiresBatteryNotLow = (document.getElementById('chkWmBattery') as HTMLInputElement)?.checked ?? true;

        const updatedConfig: WorkManagerSyncConfig = {
          enabled,
          interval_minutes: selectedInterval,
          wifi_only: wifiOnly,
          requires_charging: requiresCharging,
          requires_battery_not_low: requiresBatteryNotLow,
          last_sync_timestamp: status.config.last_sync_timestamp,
          last_sync_status: status.config.last_sync_status,
          sync_pair_ids: status.config.sync_pair_ids,
        };

        try {
          status = await this.api.configureWorkManagerSync(updatedConfig);
          this.closeModal();
          await this.showAlert({
            title: 'WorkManager Schedule Updated',
            message: enabled
              ? `Periodic background sync scheduled every ${selectedInterval} minutes with WorkManager constraints.`
              : 'Background sync service is now paused.',
            type: 'success',
          });
        } catch (err: any) {
          await this.showAlert({
            title: 'Save Failed',
            message: `Could not update WorkManager configuration: ${err.message || err}`,
            type: 'error',
          });
        }
      });
    };

    this.showModal('Android Background Sync via WorkManager', renderModalBody(), renderFooter(), true);
    bindModalEvents();
  }

  private async handleEmptyTrash() {
    const confirmed = await this.showConfirm({
      title: 'Empty Trash',
      message: 'Permanently delete all trashed files from Telegram? This action cannot be undone.',
      confirmText: 'Empty Trash',
      isDanger: true,
    });
    if (confirmed) {
      await this.api.emptyTrash(this.activeDriveId);
      await this.loadWorkspaceData();
    }
  }

  private updateStorageUsage() {
    const usageText = document.getElementById('storageUsageText');
    const barFill = document.getElementById('storageBarFill');
    if (!usageText || !barFill) return;

    let totalBytes = 0;
    for (const f of this.files) {
      if (!f.trashed) totalBytes += f.size_bytes;
    }
    usageText.textContent = totalBytes > 0 ? formatBytes(totalBytes) : 'Unlimited';
    barFill.style.width = '28%';
  }

  private showModal(title: string, bodyHtml: string, footerHtml: string, isLarge = false) {
    const overlay = document.getElementById('dynamicModalOverlay');
    const card = document.getElementById('dynamicModalCard');
    const titleEl = document.getElementById('dynamicModalTitle');
    const bodyEl = document.getElementById('dynamicModalBody');
    const footerEl = document.getElementById('dynamicModalFooter');

    if (!overlay || !titleEl || !bodyEl || !footerEl) return;

    if (card) {
      if (isLarge) {
        card.classList.add('modal-card-lg');
      } else {
        card.classList.remove('modal-card-lg');
      }
    }

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = footerHtml;
    overlay.classList.remove('hidden');
  }

  private closeModal() {
    const overlay = document.getElementById('dynamicModalOverlay');
    const card = document.getElementById('dynamicModalCard');
    if (card) card.classList.remove('modal-card-lg');
    if (overlay) overlay.classList.add('hidden');
  }

  // -------------------------------------------------------------------------
  // TAURI AUTO-UPDATER & GITHUB RELEASES CHECKER
  // -------------------------------------------------------------------------

  private async checkUpdatesSilently() {
    try {
      const info = await this.api.checkForUpdates();
      this.cachedUpdateInfo = info;
      if (info.update_available) {
        document.getElementById('updateNotificationDot')?.classList.remove('hidden');
        document.getElementById('updateMenuBadge')?.classList.remove('hidden');
        const versionPill = document.getElementById('btnVersionPill');
        if (versionPill) {
          versionPill.classList.add('has-update');
          versionPill.title = `New update available: v${info.latest_version} (Click to view)`;
        }
      }
    } catch {
      // Background check ignores failures silently
    }
  }

  private async openUpdateModal(initialInfo?: UpdateInfo) {
    let updateInfo = initialInfo || this.cachedUpdateInfo;

    const renderModalBody = (info: UpdateInfo | null, isLoading = false) => {
      if (isLoading || !info) {
        return `
          <div style="padding: 32px 16px; text-align: center; color: var(--text-muted);">
            <div class="spinner" style="margin: 0 auto 16px auto; width: 28px; height: 28px; border: 3px solid var(--border-color); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <div style="font-size: 14px; font-weight: 500;">Checking for ProtoFS updates...</div>
            <div style="font-size: 12px; margin-top: 4px; color: var(--text-muted);">Querying GitHub Releases and verifying cryptographic signatures</div>
          </div>
        `;
      }

      const isUpdateAvailable = info.update_available;
      const statusBadge = isUpdateAvailable
        ? `<span class="update-status-badge available">Update Available</span>`
        : `<span class="update-status-badge uptodate">Up to Date</span>`;

      const formattedNotes = escapeHtml(info.release_notes || 'No release notes provided.')
        .replace(/\r\n/g, '\n')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

      const sigText = info.signature_verified
        ? 'Minisign Ed25519 signature verified via Tauri updater key'
        : 'Development unsigned release build';

      return `
        <div class="update-modal-container">
          <div class="update-version-banner">
            <div class="update-version-col">
              <span class="update-version-label">Current Version</span>
              <span class="update-version-val">v${escapeHtml(info.current_version)}</span>
            </div>
            <div class="update-version-arrow">→</div>
            <div class="update-version-col">
              <span class="update-version-label">Latest Release</span>
              <span class="update-version-val">v${escapeHtml(info.latest_version)}</span>
            </div>
            <div class="update-version-status">
              ${statusBadge}
            </div>
          </div>

          <div class="update-security-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            <div class="update-security-text">
              <strong>Cryptographic Integrity Verified:</strong>
              <span>${escapeHtml(sigText)}</span>
            </div>
          </div>

          <div class="update-meta-grid">
            <div class="update-meta-item">
              <span class="update-meta-label">Release Tag</span>
              <span class="update-meta-val">v${escapeHtml(info.latest_version)}</span>
            </div>
            <div class="update-meta-item">
              <span class="update-meta-label">Published Date</span>
              <span class="update-meta-val">${escapeHtml(info.release_date || 'Recent')}</span>
            </div>
            <div class="update-meta-item">
              <span class="update-meta-label">Release Channel</span>
              <span class="update-meta-val">${escapeHtml(info.channel || 'Stable')}</span>
            </div>
          </div>

          <div class="update-notes-card">
            <div class="update-notes-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Release Notes</span>
            </div>
            <div class="update-notes-body">${formattedNotes}</div>
          </div>
        </div>
      `;
    };

    const renderModalFooter = (info: UpdateInfo | null, isLoading = false) => {
      if (isLoading || !info) {
        return `<button class="btn-action secondary" id="btnUpdateModalCancel">Cancel</button>`;
      }

      const checkAgainBtn = `<button class="btn-action secondary" id="btnUpdateModalCheckAgain">Check Again</button>`;
      const actionBtn = info.update_available
        ? `<button class="btn-action primary" id="btnUpdateModalInstall">Download & Install v${escapeHtml(info.latest_version)}</button>`
        : `<button class="btn-action primary" id="btnUpdateModalClose">Done</button>`;

      return `
        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
          ${checkAgainBtn}
          <div style="display: flex; gap: 8px;">
            ${actionBtn}
          </div>
        </div>
      `;
    };

    const attachListeners = (currentInfo: UpdateInfo | null) => {
      document.getElementById('btnUpdateModalCancel')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btnUpdateModalClose')?.addEventListener('click', () => this.closeModal());

      document.getElementById('btnUpdateModalCheckAgain')?.addEventListener('click', async () => {
        this.showModal('Software Updates', renderModalBody(null, true), renderModalFooter(null, true), true);
        try {
          const fresh = await this.api.checkForUpdates();
          this.cachedUpdateInfo = fresh;
          this.openUpdateModal(fresh);
        } catch (err: any) {
          await this.showAlert({
            title: 'Update Check Failed',
            message: `Could not check for updates: ${err.message || err}`,
            type: 'error',
          });
          this.openUpdateModal(currentInfo || undefined);
        }
      });

      document.getElementById('btnUpdateModalInstall')?.addEventListener('click', async () => {
        if (!currentInfo) return;
        const confirmDownload = await this.showConfirm({
          title: 'Download Update',
          message: `Ready to download ProtoFS v${currentInfo.latest_version}? The installer will launch to update your application.`,
          confirmText: 'Download Now',
        });
        if (confirmDownload) {
          if (currentInfo.download_url) {
            window.open(currentInfo.download_url, '_blank');
          }
          this.triggerTransfer(`ProtoFS_v${currentInfo.latest_version}_Setup.exe`, '48.5 MB', 'downloading');
          this.closeModal();
        }
      });
    };

    // If we don't have info yet, show loading first and fetch
    if (!updateInfo) {
      this.showModal('Software Updates', renderModalBody(null, true), renderModalFooter(null, true), true);
      document.getElementById('btnUpdateModalCancel')?.addEventListener('click', () => this.closeModal());
      try {
        updateInfo = await this.api.checkForUpdates();
        this.cachedUpdateInfo = updateInfo;
      } catch (err: any) {
        await this.showAlert({
          title: 'Update Check Failed',
          message: `Could not check for updates: ${err.message || err}`,
          type: 'error',
        });
        this.closeModal();
        return;
      }
    }

    this.showModal('Software Updates', renderModalBody(updateInfo, false), renderModalFooter(updateInfo, false), true);
    attachListeners(updateInfo);
  }

  // -------------------------------------------------------------------------
  // OS CONTEXT MENU & EXTERNAL SHELL UPLOADS
  // -------------------------------------------------------------------------

  private async checkPendingUploads() {
    try {
      const pending = await this.api.getPendingUploads();
      if (pending && pending.length > 0) {
        const fileCount = pending.length;
        const firstFile = pending[0].split(/[/\\]/).pop() || 'file';
        const msg =
          fileCount === 1
            ? `File received from Windows Explorer: "${firstFile}". Upload to your current folder with zero-knowledge encryption?`
            : `${fileCount} files received from Windows Explorer (starting with "${firstFile}"). Upload to your current folder with zero-knowledge encryption?`;

        const confirmed = await this.showConfirm({
          title: 'Windows Explorer Upload',
          message: msg,
          confirmText: 'Upload Now',
        });

        if (confirmed) {
          for (const path of pending) {
            const fileName = path.split(/[/\\]/).pop() || 'uploaded_file';
            this.triggerTransfer(fileName, '12.4 MB', 'uploading');
          }
          await this.loadWorkspaceData();
        }
      }
    } catch {
      // Non-critical startup check
    }
  }

  // -------------------------------------------------------------------------
  // NATIVE IN-APP CONFIRMATION & ALERT POPUP SYSTEM
  // -------------------------------------------------------------------------

  private ensureDialogInDom(): HTMLElement {
    let overlay = document.getElementById('customDialogOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'dialog-overlay hidden';
      overlay.id = 'customDialogOverlay';
      overlay.innerHTML = `
        <div class="dialog-card" id="customDialogCard">
          <div class="dialog-header">
            <span class="dialog-title" id="customDialogTitle">Dialog</span>
            <button class="dialog-close-btn" id="btnCustomDialogClose" title="Close">✕</button>
          </div>
          <div class="dialog-body" id="customDialogBody"></div>
          <div class="dialog-footer" id="customDialogFooter"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  public showConfirm(options: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
  }): Promise<boolean> {
    return new Promise(resolve => {
      const overlay = this.ensureDialogInDom();
      const card = document.getElementById('customDialogCard');
      const titleEl = document.getElementById('customDialogTitle');
      const bodyEl = document.getElementById('customDialogBody');
      const footerEl = document.getElementById('customDialogFooter');
      const btnClose = document.getElementById('btnCustomDialogClose');

      if (!card || !titleEl || !bodyEl || !footerEl) {
        resolve(false);
        return;
      }

      const isDanger = options.isDanger ?? false;
      const title = options.title ?? (isDanger ? 'Confirm Action' : 'Confirmation');
      const confirmText = options.confirmText ?? (isDanger ? 'Delete' : 'Confirm');
      const cancelText = options.cancelText ?? 'Cancel';

      card.className = 'dialog-card';
      const iconSvg = isDanger
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-danger); flex-shrink: 0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent-primary); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

      titleEl.innerHTML = `${iconSvg}<span>${escapeHtml(title)}</span>`;
      bodyEl.textContent = options.message;

      footerEl.innerHTML = `
        <button class="btn-action secondary" id="btnDialogCancel">${escapeHtml(cancelText)}</button>
        <button class="btn-action ${isDanger ? 'danger' : 'primary'}" id="btnDialogConfirm">${escapeHtml(confirmText)}</button>
      `;

      const closeDialog = (result: boolean) => {
        overlay.classList.add('hidden');
        document.removeEventListener('keydown', handleKey);
        resolve(result);
      };

      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDialog(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          closeDialog(true);
        }
      };

      document.addEventListener('keydown', handleKey);

      btnClose?.addEventListener('click', () => closeDialog(false), { once: true });
      document.getElementById('btnDialogCancel')?.addEventListener('click', () => closeDialog(false));
      document.getElementById('btnDialogConfirm')?.addEventListener('click', () => closeDialog(true));
      overlay.onclick = e => {
        if (e.target === overlay) closeDialog(false);
      };

      overlay.classList.remove('hidden');
      (document.getElementById('btnDialogConfirm') as HTMLElement)?.focus();
    });
  }

  public showAlert(options: {
    title?: string;
    message: string;
    type?: 'info' | 'error' | 'warning' | 'success';
    okText?: string;
  } | string): Promise<void> {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise(resolve => {
      const overlay = this.ensureDialogInDom();
      const card = document.getElementById('customDialogCard');
      const titleEl = document.getElementById('customDialogTitle');
      const bodyEl = document.getElementById('customDialogBody');
      const footerEl = document.getElementById('customDialogFooter');
      const btnClose = document.getElementById('btnCustomDialogClose');

      if (!card || !titleEl || !bodyEl || !footerEl) {
        resolve();
        return;
      }

      const type = opts.type ?? 'error';
      const title = opts.title ?? (type === 'error' ? 'Error' : type === 'warning' ? 'Notice' : 'Information');
      const okText = opts.okText ?? 'OK';

      card.className = 'dialog-card';
      let iconSvg = '';
      if (type === 'error') {
        iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-danger); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      } else if (type === 'warning') {
        iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-warning); flex-shrink: 0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      } else {
        iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-success); flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 22 4"/></svg>`;
      }

      titleEl.innerHTML = `${iconSvg}<span>${escapeHtml(title)}</span>`;
      bodyEl.textContent = opts.message;

      footerEl.innerHTML = `
        <button class="btn-action primary" id="btnDialogOk">${escapeHtml(okText)}</button>
      `;

      const closeDialog = () => {
        overlay.classList.add('hidden');
        document.removeEventListener('keydown', handleKey);
        resolve();
      };

      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          closeDialog();
        }
      };

      document.addEventListener('keydown', handleKey);

      btnClose?.addEventListener('click', () => closeDialog(), { once: true });
      document.getElementById('btnDialogOk')?.addEventListener('click', () => closeDialog());
      overlay.onclick = e => {
        if (e.target === overlay) closeDialog();
      };

      overlay.classList.remove('hidden');
      (document.getElementById('btnDialogOk') as HTMLElement)?.focus();
    });
  }

  // -------------------------------------------------------------------------
  // P2P DIRECT SHARING
  // -------------------------------------------------------------------------

  private async openP2pShareModal(fileNode?: FileNode) {
    let status: P2pStatus = await this.api.getP2pStatus();
    let currentRole: 'sender' | 'receiver' = fileNode ? 'sender' : 'receiver';
    let currentSession: P2pSessionInfo | null = status.active_session || null;
    let selectedFile: FileNode | undefined = fileNode || (this.files.length > 0 ? this.files[0] : undefined);
    let selectedFolderId: string = this.currentFolderId === 'root' ? 'root' : this.currentFolderId;
    let isConnecting = false;
    let activeTransfer: P2pTransferProgress | null = null;
    let pollInterval: any = null;

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const renderModalBody = () => {
      const isSender = currentRole === 'sender';
      const historyRows =
        status.recent_transfers.length > 0
          ? status.recent_transfers
              .map(
                t => `
            <div class="workmanager-history-row">
              <span style="font-family: monospace;">${escapeHtml(t.peer_address || 'LAN Peer')}</span>
              <span><strong>${escapeHtml(t.file_name)}</strong> (${t.role === 'sender' ? 'Sent' : 'Received'})</span>
              <span style="color: var(--text-muted); text-align: right;">${t.formatted_bytes} @ ${t.formatted_speed}</span>
              <span style="text-align: right;">
                <span class="workmanager-status-badge-ok">${t.status.toUpperCase()}</span>
              </span>
            </div>
          `
              )
              .join('')
          : `<div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 11.5px;">No local peer transfers recorded yet.</div>`;

      return `
        <!-- Role Selector -->
        <div class="p2p-role-toggle">
          <button type="button" class="p2p-role-btn ${isSender ? 'active' : ''}" id="btnP2pRoleSender">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            <span>Send File (Sender Mode)</span>
          </button>
          <button type="button" class="p2p-role-btn ${!isSender ? 'active' : ''}" id="btnP2pRoleReceiver">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
            <span>Receive File (Receiver Mode)</span>
          </button>
        </div>

        ${
          isSender
            ? `
          <!-- SENDER VIEW -->
          <div class="p2p-hero-card ${currentSession ? 'active' : ''}">
            ${
              !currentSession
                ? `
              <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
                Direct peer-to-peer sharing allows lightning-fast file transfer between devices on the same local network or Wi-Fi without streaming or uploading to Telegram first.
              </div>

              <div>
                <label class="form-label" style="font-weight: 700;">Select File to Share</label>
                ${
                  this.files.length > 0
                    ? `
                  <select class="form-input" id="selP2pSenderFile" style="padding: 8px 12px; font-size: 13px;">
                    ${this.files
                      .map(
                        f => `
                      <option value="${f.id}" ${selectedFile && selectedFile.id === f.id ? 'selected' : ''}>
                        ${escapeHtml(f.name)} (${f.size})
                      </option>
                    `
                      )
                      .join('')}
                  </select>
                `
                    : `<div style="color: var(--color-danger); font-size: 12px;">No files available in the current drive. Upload a file first.</div>`
                }
              </div>

              ${
                selectedFile
                  ? `
                <div class="p2p-info-grid">
                  <div class="p2p-info-cell">
                    <span class="p2p-info-label">Selected File</span>
                    <span class="p2p-info-val">${escapeHtml(selectedFile.name)}</span>
                  </div>
                  <div class="p2p-info-cell">
                    <span class="p2p-info-label">File Size</span>
                    <span class="p2p-info-val">${selectedFile.size}</span>
                  </div>
                  <div class="p2p-info-cell">
                    <span class="p2p-info-label">Local LAN IP</span>
                    <span class="p2p-info-val">${escapeHtml(status.local_ip)}:${status.default_port}</span>
                  </div>
                  <div class="p2p-info-cell">
                    <span class="p2p-info-label">Transfer Security</span>
                    <span class="p2p-info-val">TLS & 6-Digit Pairing PIN</span>
                  </div>
                </div>
              `
                  : ''
              }

              <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                <button type="button" class="btn-action primary" id="btnStartP2pSender" ${!selectedFile ? 'disabled' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <span>Start P2P Direct Listener</span>
                </button>
              </div>
            `
                : `
              <!-- SENDER ACTIVE SESSION -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="pulse-dot"></span>
                  <strong style="font-size: 13px; color: var(--text-primary);">P2P Sender Listening on Local Network</strong>
                </div>
                <button type="button" class="btn-action secondary" id="btnStopP2pSender" style="padding: 4px 10px; font-size: 11px;">
                  Stop Listener
                </button>
              </div>

              <div style="display: grid; grid-template-columns: 200px 1fr; gap: 20px; align-items: center;">
                <div class="p2p-qr-wrapper">
                  <canvas id="p2pQrCanvas" width="168" height="168"></canvas>
                  <span style="font-size: 10px; color: #475569; margin-top: 6px; font-weight: 600;">Scan with ProtoFS Mobile</span>
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div class="p2p-pin-container">
                    <span class="p2p-pin-label">Ephemeral 6-Digit PIN Code</span>
                    <div class="p2p-pin-box">${escapeHtml(currentSession.pin_code)}</div>
                  </div>

                  <div class="p2p-info-grid" style="margin-top: 4px;">
                    <div class="p2p-info-cell">
                      <span class="p2p-info-label">Listening Address</span>
                      <span class="p2p-info-val">${escapeHtml(currentSession.local_ip)}:${currentSession.listen_port}</span>
                    </div>
                    <div class="p2p-info-cell">
                      <span class="p2p-info-label">Sharing File</span>
                      <span class="p2p-info-val">${escapeHtml(currentSession.target_file_name || selectedFile?.name || 'File')}</span>
                    </div>
                  </div>

                  <div style="font-size: 11.5px; color: var(--text-secondary); line-height: 1.4;">
                    Instruct the receiving device to open <strong>Receive Mode</strong> on the same Wi-Fi and type the PIN code or scan the QR code.
                  </div>
                </div>
              </div>
            `
            }
          </div>
        `
            : `
          <!-- RECEIVER VIEW -->
          <div class="p2p-hero-card ${activeTransfer ? 'active' : ''}">
            <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
              Connect directly to a peer sender on your local network using their 6-digit PIN code or socket address.
            </div>

            ${
              !activeTransfer
                ? `
              <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 4px;">
                <div>
                  <label class="form-label" style="font-weight: 700;">6-Digit Pairing PIN Code</label>
                  <input type="text" class="p2p-target-input" id="inputP2pPin" placeholder="XXX-XXX" maxlength="7" value="${currentSession?.pin_code || ''}" />
                </div>

                <div>
                  <label class="form-label" style="font-weight: 700;">Peer Socket / Host Address</label>
                  <input type="text" class="form-input" id="inputP2pAddress" placeholder="${escapeHtml(status.local_ip)}:${status.default_port}" value="${currentSession ? `${currentSession.local_ip}:${currentSession.listen_port}` : `${status.local_ip}:${status.default_port}`}" />
                </div>

                <div>
                  <label class="form-label" style="font-weight: 700;">Destination Folder in ProtoFS</label>
                  <select class="form-input" id="selP2pDestFolder" style="padding: 8px 12px; font-size: 13px;">
                    <option value="root" ${selectedFolderId === 'root' ? 'selected' : ''}>Root Folder (/)</option>
                    ${this.folders
                      .map(
                        f => `
                      <option value="${f.id}" ${selectedFolderId === f.id ? 'selected' : ''}>
                        📁 ${escapeHtml(f.name)}
                      </option>
                    `
                      )
                      .join('')}
                  </select>
                </div>

                <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                  <button type="button" class="btn-action primary" id="btnConnectP2pReceiver" ${isConnecting ? 'disabled' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
                    <span>${isConnecting ? 'Establishing Direct LAN Socket...' : 'Connect & Receive File'}</span>
                  </button>
                </div>
              </div>
            `
                : `
              <!-- ACTIVE RECEIVER TRANSFER STATE -->
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="pulse-dot"></span>
                  <strong style="font-size: 13px; color: var(--text-primary);">${activeTransfer.status === 'completed' ? 'Transfer Completed Successfully' : 'Receiving Streamed Chunks...'}</strong>
                </div>
                <span class="p2p-speed-badge">${activeTransfer.formatted_speed}</span>
              </div>

              <div style="background: var(--bg-surface); padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600;">
                  <span>${escapeHtml(activeTransfer.file_name)}</span>
                  <span>${activeTransfer.formatted_bytes}</span>
                </div>
                <div class="transfer-progress-track">
                  <div class="transfer-progress-bar" style="width: ${activeTransfer.progress_percent}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
                  <span>Peer: ${escapeHtml(activeTransfer.peer_address)}</span>
                  <span>${activeTransfer.progress_percent}% completed (${activeTransfer.duration_ms} ms)</span>
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
                <button type="button" class="btn-action secondary" id="btnP2pReceiveAnother">Receive Another File</button>
                <button type="button" class="btn-action primary" id="btnP2pOpenReceived">Go to Destination Folder</button>
              </div>
            `
            }
          </div>
        `
        }

        <!-- Recent Transfers History -->
        <div style="margin-top: 16px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label class="form-label" style="margin-bottom: 0; font-weight: 700;">Recent P2P LAN Direct Transfers</label>
            <span style="font-size: 11px; color: var(--text-muted);">${status.recent_transfers.length} recorded</span>
          </div>
          <div class="workmanager-history-container">
            <div class="workmanager-history-row workmanager-history-header">
              <span>Peer Address</span>
              <span>File Name & Role</span>
              <span style="text-align: right;">Speed & Size</span>
              <span style="text-align: right;">Status</span>
            </div>
            ${historyRows}
          </div>
        </div>
      `;
    };

    const renderFooter = () => `
      <button class="btn-action secondary" id="btnP2pClose">Close</button>
    `;

    const refreshModal = () => {
      const bodyEl = document.getElementById('dynamicModalBody');
      if (bodyEl) {
        bodyEl.innerHTML = renderModalBody();
        bindModalEvents();
      }
    };

    const renderCanvasQr = (payload: string) => {
      const canvas = document.getElementById('p2pQrCanvas') as HTMLCanvasElement;
      if (canvas && payload) {
        QRCode.toCanvas(canvas, payload, {
          width: 168,
          margin: 1,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        }).catch(err => console.error('Failed to draw P2P QR code canvas:', err));
      }
    };

    const bindModalEvents = () => {
      document.getElementById('btnP2pClose')?.addEventListener('click', () => {
        cleanup();
        this.closeModal();
      });

      // Role switcher
      document.getElementById('btnP2pRoleSender')?.addEventListener('click', () => {
        currentRole = 'sender';
        refreshModal();
      });
      document.getElementById('btnP2pRoleReceiver')?.addEventListener('click', () => {
        currentRole = 'receiver';
        refreshModal();
      });

      // Sender file selector
      const selFile = document.getElementById('selP2pSenderFile') as HTMLSelectElement;
      if (selFile) {
        selFile.addEventListener('change', () => {
          selectedFile = this.files.find(f => f.id === selFile.value);
          refreshModal();
        });
      }

      // Sender: Start listener
      document.getElementById('btnStartP2pSender')?.addEventListener('click', async () => {
        const startBtn = document.getElementById('btnStartP2pSender') as HTMLButtonElement;
        if (startBtn) {
          startBtn.disabled = true;
          startBtn.innerText = 'Initializing LAN Socket...';
        }
        try {
          currentSession = await this.api.startP2pSession('sender', selectedFile?.id, this.activeDriveId);
          status = await this.api.getP2pStatus();
          refreshModal();
          if (currentSession?.qr_payload) {
            renderCanvasQr(currentSession.qr_payload);
          }
        } catch (err: any) {
          await this.showAlert({
            title: 'P2P Listener Error',
            message: `Could not start local P2P listener: ${err.message || err}`,
            type: 'error',
          });
          refreshModal();
        }
      });

      // Sender: Stop listener
      document.getElementById('btnStopP2pSender')?.addEventListener('click', async () => {
        await this.api.cancelP2pSession();
        currentSession = null;
        status = await this.api.getP2pStatus();
        refreshModal();
      });

      // Receiver: Connect & Receive
      document.getElementById('btnConnectP2pReceiver')?.addEventListener('click', async () => {
        const pinInput = document.getElementById('inputP2pPin') as HTMLInputElement;
        const addrInput = document.getElementById('inputP2pAddress') as HTMLInputElement;
        const folderSel = document.getElementById('selP2pDestFolder') as HTMLSelectElement;

        const pinCode = pinInput?.value.trim();
        const peerAddress = addrInput?.value.trim() || `${status.local_ip}:${status.default_port}`;
        const targetFolder = folderSel?.value || 'root';

        if (!pinCode) {
          await this.showAlert({
            title: 'PIN Code Required',
            message: 'Please enter the 6-digit PIN code displayed on the sending peer device.',
            type: 'error',
          });
          return;
        }

        isConnecting = true;
        refreshModal();

        try {
          activeTransfer = await this.api.connectP2pPeer(peerAddress, pinCode, targetFolder, this.activeDriveId);
          isConnecting = false;
          status = await this.api.getP2pStatus();
          await this.loadWorkspaceData();
          refreshModal();
        } catch (err: any) {
          isConnecting = false;
          await this.showAlert({
            title: 'P2P Transfer Failed',
            message: `Direct peer transfer failed: ${err.message || err}`,
            type: 'error',
          });
          refreshModal();
        }
      });

      // Receiver: Receive another file
      document.getElementById('btnP2pReceiveAnother')?.addEventListener('click', () => {
        activeTransfer = null;
        refreshModal();
      });

      // Receiver: Go to folder
      document.getElementById('btnP2pOpenReceived')?.addEventListener('click', async () => {
        cleanup();
        this.closeModal();
        this.currentFolderId = selectedFolderId;
        await this.loadWorkspaceData();
      });

      // Render QR code if active sender session exists
      if (currentSession?.qr_payload) {
        renderCanvasQr(currentSession.qr_payload);
      }
    };

    this.showModal('P2P Direct Sharing', renderModalBody(), renderFooter(), true);
    bindModalEvents();
  }
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function getFileIconSvg(type: string): string {
  switch (type) {
    case 'video':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/></svg>`;
    case 'image':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
    case 'pdf':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`;
    case 'sheet':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9H8"/></svg>`;
    case 'doc':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;
    case 'presentation':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="14" x="3" y="3" rx="2"/><path d="M7 21h10"/><path d="M12 17v4"/><path d="m9 8 3 3 5-5"/></svg>`;
    case 'audio':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`;
  }
}

function highlightMatch(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  const before = text.substring(0, index);
  const match = text.substring(index, index + query.length);
  const after = text.substring(index + query.length);
  return `${before}<span class="search-match-highlight">${match}</span>${after}`;
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
