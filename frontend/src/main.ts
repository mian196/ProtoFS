import './style.css';
import QRCode from 'qrcode';
import { ProtoFsApi } from './api';
import { ThemeManager } from './theme';
import type { AuthSession, DriveMetadata, FileNode, FolderNode, SyncPair, TransferItem } from './types';

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

  private drives: DriveMetadata[] = [];
  private folders: FolderNode[] = [];
  private files: FileNode[] = [];
  private syncPairs: SyncPair[] = [];
  private accounts: AuthSession[] = [];
  private isAddingAccount = false;

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
      if (!this.session.is_demo) {
        localStorage.removeItem('protofs_folders');
        localStorage.removeItem('protofs_files');
        localStorage.removeItem('protofs_drives');
      }
      this.activeDriveId = this.session.active_drive_id || (this.session.is_demo ? 'personal' : `drive_${this.session.user_id}`);
      await this.initWorkspace();
    }
  }

  // -------------------------------------------------------------------------
  // TELEGRAM MTPROTO ONBOARDING & LOGIN SCREEN (PRD Section 6.1 & 6.18)
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

              <button type="button" class="demo-credentials-btn" id="btnQuickDemo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span>Use Quick Test / Demo Mode</span>
              </button>

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
                  <input type="text" class="form-input" id="inputApiId" placeholder="API ID (e.g. 20401928)" value="${escapeHtml(this.loginApiId || '20491820')}" required>
                  <input type="password" class="form-input" id="inputApiHash" placeholder="API Hash (e.g. 3a9f...)" value="${escapeHtml(this.loginApiHash || 'e8b7c6d5a4f3210987654321fedcba09')}" required>
                </div>
              </div>

              <button type="button" class="demo-credentials-btn" id="btnQuickDemo" style="width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span>Use Quick Test / Demo Mode</span>
              </button>

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

    const btnQuickDemo = document.getElementById('btnQuickDemo');
    if (btnQuickDemo) {
      btnQuickDemo.addEventListener('click', async () => {
        const idEl = document.getElementById('inputApiId') as HTMLInputElement;
        const hashEl = document.getElementById('inputApiHash') as HTMLInputElement;
        const phoneEl = document.getElementById('inputPhone') as HTMLInputElement;
        if (idEl) idEl.value = '20491820';
        if (hashEl) hashEl.value = 'e8b7c6d5a4f3210987654321fedcba09';
        if (phoneEl) phoneEl.value = '+1 (202) 555-0196';

        this.loginApiId = '20491820';
        this.loginApiHash = 'e8b7c6d5a4f3210987654321fedcba09';
        this.loginPhone = '+1 (202) 555-0196';

        if (this.authMethod === 'qr') {
          // In QR mode, Quick Demo logs in directly with demo mode
          try {
            const res = await this.api.loginVerifyCode(
              '+1 (202) 555-0196',
              'demo',
              'demo',
              '12345'
            );
            if (res.session) {
              this.session = res.session;
              this.isAddingAccount = false;
              this.stopQrPolling();
              this.activeDriveId = 'personal';
              await this.initWorkspace();
            }
          } catch (err: any) {
            alert(`Demo login error: ${err.message}`);
          }
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
            if (!res.session.is_demo) {
              localStorage.removeItem('protofs_folders');
              localStorage.removeItem('protofs_files');
              localStorage.removeItem('protofs_drives');
            }
            this.activeDriveId = res.session.active_drive_id || (res.session.is_demo ? 'personal' : `drive_${res.session.user_id}`);
            await this.initWorkspace();
          }
        } catch (err: any) {
          alert(`Verification error: ${err.message}`);
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
            if (!res.session.is_demo) {
              localStorage.removeItem('protofs_folders');
              localStorage.removeItem('protofs_files');
              localStorage.removeItem('protofs_drives');
            }
            this.activeDriveId = res.session.active_drive_id || (res.session.is_demo ? 'personal' : `drive_${res.session.user_id}`);
            await this.initWorkspace();
          }
        } catch (err: any) {
          alert(`2FA verification error: ${err.message}`);
        }
      });
    }
  }

  private async initQrLogin() {
    this.stopQrPolling();
    const idEl = document.getElementById('inputApiId') as HTMLInputElement;
    const hashEl = document.getElementById('inputApiHash') as HTMLInputElement;
    const apiId = idEl ? idEl.value.trim() : this.loginApiId || '20491820';
    const apiHash = hashEl ? hashEl.value.trim() : this.loginApiHash || 'e8b7c6d5a4f3210987654321fedcba09';
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
            if (!check.session.is_demo) {
              localStorage.removeItem('protofs_folders');
              localStorage.removeItem('protofs_files');
              localStorage.removeItem('protofs_drives');
            }
            this.activeDriveId = check.session.active_drive_id || (check.session.is_demo ? 'personal' : `drive_${check.session.user_id}`);
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
  }

  private renderAppShell() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    const userInitial = this.session?.first_name ? this.session.first_name.slice(0, 2).toUpperCase() : 'MZ';
    const userName = this.session?.username ? `@${this.session.username}` : (this.session?.phone || 'Connected');

    appEl.innerHTML = `
      <!-- Top Header Title Bar -->
      <header class="proto-header">
        <div class="brand-box">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
          <span class="brand-name">ProtoFS</span>
          <span class="version-pill">v0.2.0</span>
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
              <button class="icon-btn" id="btnNewDrive" title="New Telegram Drive" style="width:22px;height:22px;">+</button>
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
    }
    this.syncPairs = await this.api.getSyncPairs(this.activeDriveId);

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
          <button class="btn-action primary" id="btnAddSyncPair">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add Sync Pair</span>
          </button>
        `;
        document.getElementById('btnAddSyncPair')?.addEventListener('click', () => this.openAddSyncPairModal());
      }
      this.renderSyncPairsView();
      return;
    }

    if (filesSection) filesSection.style.display = 'block';

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
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-meta">${f.size} • ${f.date} ${f.encrypted ? '• 🔒 Encrypted' : ''} ${f.pinned ? '• 📌 Pinned' : ''}</span>
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

  // -------------------------------------------------------------------------
  // DYNAMIC SELECTION ACTION BAR
  // -------------------------------------------------------------------------

  private updateSelectionBar() {
    const bar = document.getElementById('selectionFloatingBar');
    const countPill = document.getElementById('selectionCountPill');
    const btnSelPreview = document.getElementById('btnSelPreview');
    const btnSelRename = document.getElementById('btnSelRename');

    if (!bar || !countPill) return;

    const count = this.selectedIds.size;
    if (count === 0) {
      bar.classList.add('hidden');
      return;
    }

    bar.classList.remove('hidden');
    countPill.textContent = `${count} item${count > 1 ? 's' : ''} selected`;

    // Preview and Rename are only active for single item selection
    if (btnSelPreview) btnSelPreview.style.display = count === 1 ? 'flex' : 'none';
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
          <p style="font-size: 12px; margin-bottom: 16px;">Map a local OS folder to Telegram for continuous real-time backup.</p>
          <button class="btn-action primary" id="btnEmptyAddSync">Add First Sync Pair</button>
        </div>
      `;
      document.getElementById('btnEmptyAddSync')?.addEventListener('click', () => this.openAddSyncPairModal());
      return;
    }

    grid.innerHTML = this.syncPairs
      .map(
        p => `
        <div class="sync-pair-card">
          <div class="sync-pair-info">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sync-pair-path">${escapeHtml(p.local_path)}</span>
              <span class="sync-mode-pill">${p.sync_mode}</span>
            </div>
            <div class="sync-pair-sub">Mapped to folder: <code>${escapeHtml(p.remote_folder_id)}</code> • ${p.status}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-action secondary btn-sync-now" data-sync-id="${p.id}" title="Run Sync Now">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
              <span>Sync Now</span>
            </button>
            <button class="btn-action secondary btn-del-sync" data-sync-id="${p.id}" title="Remove Sync Pair" style="color: var(--color-danger);">✕</button>
          </div>
        </div>
      `
      )
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
        if (id && confirm('Remove this Sync Pair?')) {
          await this.api.removeSyncPair(id);
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
          this.activeDriveId = newSession.active_drive_id || (newSession.is_demo ? 'personal' : `drive_${newSession.user_id}`);
          this.currentFolderId = 'root';
          this.activeFilter = null;
          await this.initWorkspace();
        } catch (err: any) {
          alert(`Failed to switch account: ${err.message || err}`);
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
        if (!confirm('Disconnect and remove this Telegram account from ProtoFS?')) {
          return;
        }
        try {
          const nextSession = await this.api.removeAccount(uid);
          if (nextSession) {
            this.session = nextSession;
            this.activeDriveId = nextSession.active_drive_id || (nextSession.is_demo ? 'personal' : `drive_${nextSession.user_id}`);
            this.currentFolderId = 'root';
            this.activeFilter = null;
            await this.initWorkspace();
          } else {
            this.session = null;
            this.loginStep = 'credentials';
            this.renderLoginScreen();
          }
        } catch (err: any) {
          alert(`Failed to remove account: ${err.message || err}`);
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
      if (!confirm('Log out and disconnect your current Telegram account?')) {
        return;
      }
      try {
        if (this.session) {
          const nextSession = await this.api.removeAccount(this.session.user_id);
          if (nextSession) {
            this.session = nextSession;
            this.activeDriveId = nextSession.active_drive_id || (nextSession.is_demo ? 'personal' : `drive_${nextSession.user_id}`);
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
        alert(`Logout error: ${err.message || err}`);
      }
    });

    // Account Security & Settings
    document.getElementById('btnAccountSettings')?.addEventListener('click', () => {
      this.showModal(
        'Zero-Knowledge Security',
        `
        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
          <p><strong>Argon2id Key Derivation:</strong> Master password derived on-device. No plain passphrase leaves this device.</p>
          <p style="margin-top: 8px;"><strong>MTProto Session:</strong> Active with Telegram User ID <code>${this.session?.user_id || '1049281720'}</code>.</p>
          <p style="margin-top: 8px;"><strong>Local SQLite Cache:</strong> <code>cache.db</code> in Write-Ahead Logging (WAL) mode with FTS5 search index.</p>
        </div>
      `,
        `<button class="btn-action primary" id="btnModalCloseDone">Done</button>`
      );
      document.getElementById('btnModalCloseDone')?.addEventListener('click', () => this.closeModal());
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

    // New Drive Modal button in sidebar
    document.getElementById('btnNewDrive')?.addEventListener('click', () => {
      this.showModal(
        'Create Telegram Drive',
        `
        <div class="form-group">
          <label class="form-label">Drive Name</label>
          <input type="text" class="form-input" id="inputNewDriveName" placeholder="e.g. Media Vault" required>
        </div>
        <div class="form-group">
          <label class="form-label">Telegram Channel ID</label>
          <input type="number" class="form-input" id="inputNewDriveChannel" placeholder="e.g. -1001928472910" required>
        </div>
      `,
        `
        <button class="btn-action secondary" id="btnCancelDrive">Cancel</button>
        <button class="btn-action primary" id="btnConfirmDrive">Create Drive</button>
      `
      );

      document.getElementById('btnCancelDrive')?.addEventListener('click', () => this.closeModal());
      document.getElementById('btnConfirmDrive')?.addEventListener('click', async () => {
        const nameEl = document.getElementById('inputNewDriveName') as HTMLInputElement;
        const chanEl = document.getElementById('inputNewDriveChannel') as HTMLInputElement;
        if (nameEl && chanEl && nameEl.value.trim()) {
          const drive = await this.api.createDrive(nameEl.value.trim(), Number(chanEl.value) || -1001000000000);
          this.activeDriveId = drive.id;
          this.closeModal();
          await this.loadWorkspaceData();
        }
      });
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

  private openFilePreview(file: FileNode) {
    let previewContent = '';

    if (file.type === 'video') {
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
      <button class="btn-action secondary" id="btnPreviewDownload">Download</button>
      <button class="btn-action primary" id="btnPreviewClose">Done</button>
    `
    );

    document.getElementById('btnPreviewClose')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnPreviewDownload')?.addEventListener('click', () => {
      this.closeModal();
      this.triggerTransfer(file.name, file.size, 'downloading');
    });
  }

  private async handleEmptyTrash() {
    if (confirm('Permanently delete all trashed files from Telegram? This action cannot be undone.')) {
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

  private showModal(title: string, bodyHtml: string, footerHtml: string) {
    const overlay = document.getElementById('dynamicModalOverlay');
    const titleEl = document.getElementById('dynamicModalTitle');
    const bodyEl = document.getElementById('dynamicModalBody');
    const footerEl = document.getElementById('dynamicModalFooter');

    if (!overlay || !titleEl || !bodyEl || !footerEl) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = footerHtml;
    overlay.classList.remove('hidden');
  }

  private closeModal() {
    const overlay = document.getElementById('dynamicModalOverlay');
    if (overlay) overlay.classList.add('hidden');
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
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'sheet':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9H8"/></svg>`;
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
