import React, { useState, useEffect } from 'react';
import {
  Check,
  Plus,
  Trash2,
  Edit2,
  Activity,
  Loader2,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Server,
  ShieldCheck,
  ShieldAlert,
  X,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { useProxyStore } from '../../stores/useProxyStore';
import { confirmDialog } from '../../stores/useConfirmStore';
import { proxyApi } from '../../api/proxy';
import { classifySecret, validateProxyForm } from '../../utils/proxyLinkParser';
import type {
  ProxyConfig,
  ProxyProfile,
  ProxyProfileSummary,
  ProxyType,
} from '../../types';
import { toast } from 'sonner';

export const ProxyTab: React.FC = () => {
  const {
    proxies,
    activeProxyId,
    isEnabled,
    testingProxyIds,
    testResults,
    loadProxies,
    saveProxy,
    deleteProxy,
    setActiveProxy,
    toggleProxyEnabled,
    testProxy,
    importFromLink,
  } = useProxyStore();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickImportText, setQuickImportText] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});

  const [draftForm, setDraftForm] = useState<Partial<ProxyProfile>>({
    id: '',
    label: '',
    proxy_type: 'mtproto',
    host: '',
    port: 443,
    secret: '',
    username: '',
    password: '',
    is_active: false,
  });

  useEffect(() => {
    loadProxies();
  }, [loadProxies]);

  // Quick import handling
  const handleQuickImport = (linkToParse?: string) => {
    const text = (linkToParse ?? quickImportText).trim();
    if (!text) return;

    const parsed = importFromLink(text);
    if (parsed.isValid && parsed.host && parsed.port && parsed.proxyType) {
      setDraftForm({
        id: '',
        label:
          parsed.proxyType === 'mtproto'
            ? `MTProto (${parsed.host})`
            : `SOCKS5 (${parsed.host})`,
        proxy_type: parsed.proxyType,
        host: parsed.host,
        port: parsed.port,
        secret: parsed.secret || '',
        username: parsed.username || '',
        password: parsed.password || '',
        is_active: proxies.length === 0,
      });
      setFormErrors({});
      setEditingId(null);
      setIsEditorOpen(true);
      setQuickImportText('');
    }
  };

  const handleQuickImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuickImportText(val);
    if (/^(tg:\/\/|https?:\/\/(t\.me|telegram\.me)\/)/i.test(val.trim())) {
      handleQuickImport(val);
    }
  };

  // Open editor for new profile
  const handleOpenAddProfile = () => {
    setDraftForm({
      id: '',
      label: '',
      proxy_type: 'mtproto',
      host: '',
      port: 443,
      secret: '',
      username: '',
      password: '',
      is_active: proxies.length === 0,
    });
    setFormErrors({});
    setEditingId(null);
    setIsEditorOpen(true);
  };

  // Load full decrypted profile for editing (T-04-02)
  const handleEditProfile = async (id: string) => {
    try {
      const fullProfile = await proxyApi.getProxy(id);
      if (!fullProfile) {
        toast.error('Failed to load profile details');
        return;
      }
      setDraftForm({
        id: fullProfile.id,
        label: fullProfile.label,
        proxy_type: fullProfile.proxy_type,
        host: fullProfile.host,
        port: fullProfile.port,
        secret: fullProfile.secret || '',
        username: fullProfile.username || '',
        password: fullProfile.password || '',
        is_active: fullProfile.is_active,
        created_at: fullProfile.created_at,
      });
      setFormErrors({});
      setEditingId(id);
      setIsEditorOpen(true);
    } catch (err) {
      toast.error(`Error loading profile: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Delete profile with confirmation dialog (D-02, UI-SPEC)
  const handleDeleteProfile = async (profile: ProxyProfileSummary) => {
    const confirmed = await confirmDialog({
      title: 'Delete Proxy Profile',
      message: `Are you sure you want to delete profile "${profile.label}"? This action cannot be undone.`,
      confirmText: 'Delete Profile',
      cancelText: 'Cancel',
      variant: 'danger',
      icon: 'trash',
    });

    if (confirmed) {
      await deleteProxy(profile.id);
      if (editingId === profile.id) {
        setIsEditorOpen(false);
        setEditingId(null);
      }
    }
  };

  // Test profile connection from list card
  const handleTestCardProxy = async (profile: ProxyProfileSummary) => {
    const full = await proxyApi.getProxy(profile.id);
    if (full) {
      const config: ProxyConfig = {
        proxy_type: full.proxy_type,
        host: full.host,
        port: full.port,
        secret: full.secret,
        username: full.username,
        password: full.password,
      };
      const res = await testProxy(config, profile.id);
      if (res.is_connected && res.latency_ms !== null) {
        toast.success(`Connected to proxy "${profile.label}" (${res.latency_ms}ms)`);
      } else {
        toast.error(res.message || `Failed to connect to proxy "${profile.label}"`);
      }
    }
  };

  // Test draft configuration inside editor
  const handleTestDraft = async () => {
    const errors = validateProxyForm({
      proxyType: draftForm.proxy_type || 'mtproto',
      host: draftForm.host || '',
      port: draftForm.port || 0,
      secret: draftForm.secret,
      username: draftForm.username,
      password: draftForm.password,
    });
    setFormErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      toast.error('Please resolve validation errors before testing');
      return;
    }

    const config: ProxyConfig = {
      proxy_type: draftForm.proxy_type || 'mtproto',
      host: draftForm.host!.trim(),
      port: Number(draftForm.port),
      secret: draftForm.secret ? draftForm.secret.trim() : undefined,
      username: draftForm.username ? draftForm.username.trim() : undefined,
      password: draftForm.password || undefined,
    };

    const res = await testProxy(config, 'draft');
    if (res.is_connected && res.latency_ms !== null) {
      toast.success(`Connection successful! Latency: ${res.latency_ms}ms`);
    } else {
      toast.error(res.message || 'Connection test failed');
    }
  };

  // Save profile draft
  const handleSaveProfile = async () => {
    const errors = validateProxyForm({
      proxyType: draftForm.proxy_type || 'mtproto',
      host: draftForm.host || '',
      port: draftForm.port || 0,
      secret: draftForm.secret,
      username: draftForm.username,
      password: draftForm.password,
    });

    const label = draftForm.label?.trim() || `${(draftForm.proxy_type || 'mtproto').toUpperCase()} (${draftForm.host})`;

    setFormErrors(errors);
    if (Object.values(errors).some(Boolean)) {
      toast.error('Please correct the highlighted form errors');
      return;
    }

    setIsSaving(true);
    try {
      const profileToSave: ProxyProfile = {
        id: editingId || crypto.randomUUID(),
        label,
        proxy_type: draftForm.proxy_type || 'mtproto',
        host: draftForm.host!.trim(),
        port: Number(draftForm.port),
        secret: draftForm.proxy_type === 'mtproto' ? draftForm.secret?.trim() || undefined : undefined,
        username: draftForm.proxy_type !== 'mtproto' ? draftForm.username?.trim() || undefined : undefined,
        password: draftForm.proxy_type !== 'mtproto' ? draftForm.password || undefined : undefined,
        is_active: draftForm.is_active ?? (proxies.length === 0),
        created_at: draftForm.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const success = await saveProxy(profileToSave);
      if (success) {
        setIsEditorOpen(false);
        setEditingId(null);
        setDraftForm({
          id: '',
          label: '',
          proxy_type: 'mtproto',
          host: '',
          port: 443,
          secret: '',
          username: '',
          password: '',
          is_active: false,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const renderLatencyBadge = (id: string) => {
    if (testingProxyIds[id]) {
      return (
        <Badge variant="amber" size="sm" icon={<Loader2 className="w-3 h-3 animate-spin" />}>
          Pinging...
        </Badge>
      );
    }

    const result = testResults[id];
    if (!result) return null;

    if (!result.is_connected || result.latency_ms === null) {
      return (
        <Badge variant="rose" size="sm" icon={<ShieldAlert className="w-3 h-3" />}>
          Error
        </Badge>
      );
    }

    const ms = result.latency_ms;
    if (ms < 150) {
      return (
        <Badge variant="emerald" size="sm" icon={<ShieldCheck className="w-3 h-3" />}>
          {ms}ms
        </Badge>
      );
    }
    if (ms <= 300) {
      return (
        <Badge variant="amber" size="sm" icon={<ShieldCheck className="w-3 h-3" />}>
          {ms}ms
        </Badge>
      );
    }
    return (
      <Badge variant="rose" size="sm" icon={<ShieldAlert className="w-3 h-3" />}>
        {ms}ms
      </Badge>
    );
  };

  const renderSecretClassifier = (summary: ProxyProfileSummary) => {
    if (summary.proxy_type !== 'mtproto' || !summary.masked_secret) return null;
    const lower = summary.masked_secret.toLowerCase();
    if (lower.startsWith('ee')) {
      return (
        <Badge variant="emerald" size="sm">
          Fake-TLS (ee)
        </Badge>
      );
    }
    if (lower.startsWith('dd')) {
      return (
        <Badge variant="sky" size="sm">
          Obfuscated (dd)
        </Badge>
      );
    }
    return (
      <Badge variant="slate" size="sm">
        Standard MTProto
      </Badge>
    );
  };

  const draftSecretClassification =
    draftForm.proxy_type === 'mtproto' && draftForm.secret
      ? classifySecret(draftForm.secret)
      : null;

  const countSubtitle =
    proxies.length === 1 ? '1 proxy profile configured' : `${proxies.length} proxy profiles configured`;

  return (
    <div className="space-y-6">
      {/* 1. Master Routing Switch (D-02) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Telegram Proxy Routing
              </h4>
              <Badge variant={isEnabled ? 'emerald' : 'slate'} size="sm">
                {isEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Route all Telegram MTProto API calls, file uploads, and downloads through configured proxy servers.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isEnabled}
              onChange={(e) => toggleProxyEnabled(e.target.checked)}
              aria-label="Toggle Telegram proxy routing"
            />
            <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
          </label>
        </div>
      </div>

      {/* 2. Quick-Import Link Bar (D-02) */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Quick-Import Proxy Link
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Paste a Telegram proxy link (<code className="text-sky-500">tg://proxy</code>,{' '}
            <code className="text-sky-500">tg://socks</code>, or <code className="text-sky-500">https://t.me/proxy</code>) to automatically populate connection details.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Paste tg://proxy?server=... or https://t.me/proxy?..."
            value={quickImportText}
            onChange={handleQuickImportChange}
            icon={<LinkIcon className="w-4 h-4" />}
          />
          <Button
            variant="secondary"
            size="md"
            onClick={() => handleQuickImport()}
            disabled={!quickImportText.trim()}
          >
            Import Proxy Link
          </Button>
        </div>
      </div>

      {/* 3. Saved Profiles Section (D-02) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Saved Proxy Profiles
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">{countSubtitle}</p>
          </div>
          {!isEditorOpen && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddProfile}
            >
              Add Proxy Profile
            </Button>
          )}
        </div>

        {/* Empty state when 0 profiles and editor is closed */}
        {proxies.length === 0 && !isEditorOpen && (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 text-sky-500 flex items-center justify-center mx-auto">
              <Server className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No Proxy Profiles Configured
              </h5>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Add an MTProto, SOCKS5, or HTTP proxy to route Telegram traffic through restricted networks, or paste a Telegram proxy link above.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddProfile}
            >
              Add Proxy Profile
            </Button>
          </div>
        )}

        {/* Profile cards list with max-height constraint */}
        {proxies.length > 0 && !isEditorOpen && (
          <div className="max-h-[380px] overflow-y-auto pr-1 space-y-2">
            {proxies.map((profile) => {
              const isActive = activeProxyId === profile.id;
              return (
                <div
                  key={profile.id}
                  className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-sky-500/5 dark:bg-sky-500/10 border-sky-500/30'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Active Radio Selector */}
                    <button
                      onClick={() => setActiveProxy(isActive ? null : profile.id)}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        isActive
                          ? 'border-sky-500 bg-sky-500 text-white'
                          : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                      aria-label={isActive ? 'Deactivate proxy profile' : 'Activate proxy profile'}
                    >
                      {isActive && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </button>

                    {/* Profile Metadata */}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                          {profile.label}
                        </span>
                        <Badge variant="sky" size="sm">
                          {profile.proxy_type.toUpperCase()}
                        </Badge>
                        {renderSecretClassifier(profile)}
                        {renderLatencyBadge(profile.id)}
                      </div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">
                        {profile.host}:{profile.port}
                        {profile.masked_secret && (
                          <span className="text-slate-400 dark:text-slate-500">
                            {' '}
                            • Secret: {profile.masked_secret}
                          </span>
                        )}
                        {profile.username && (
                          <span className="text-slate-400 dark:text-slate-500">
                            {' '}
                            • User: {profile.username}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={
                        testingProxyIds[profile.id] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5" />
                        )
                      }
                      disabled={testingProxyIds[profile.id]}
                      onClick={() => handleTestCardProxy(profile)}
                      title="Test Connection"
                    >
                      {testingProxyIds[profile.id] ? 'Testing Connection...' : 'Test Connection'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditProfile(profile.id)}
                      title="Edit Profile"
                      aria-label="Edit Profile"
                    >
                      <Edit2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteProfile(profile)}
                      title="Delete Profile"
                      aria-label="Delete Profile"
                    >
                      <Trash2 className="w-4 h-4 text-rose-500 hover:text-rose-600 dark:text-rose-400" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Expandable Editor Drawer (D-02, UI-SPEC) */}
      {isEditorOpen && (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-sky-500/30 shadow-lg space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {editingId ? 'Edit Proxy Profile' : 'Add Proxy Profile'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure connection endpoints, authentication secrets, and credentials.
              </p>
            </div>
            <button
              onClick={() => {
                setIsEditorOpen(false);
                setEditingId(null);
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Close editor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* Profile Label */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Profile Label
              </label>
              <Input
                placeholder="e.g., Fast European MTProto"
                value={draftForm.label || ''}
                onChange={(e) => setDraftForm({ ...draftForm, label: e.target.value })}
              />
            </div>

            {/* Protocol Type Selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Protocol Type
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl">
                {(['mtproto', 'socks5', 'http'] as ProxyType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setDraftForm({ ...draftForm, proxy_type: type })}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                      draftForm.proxy_type === type
                        ? 'bg-white dark:bg-slate-900 text-sky-500 dark:text-sky-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Host Input */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Server Host / IP <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="e.g., 149.154.167.50 or proxy.example.com"
                value={draftForm.host || ''}
                onChange={(e) => {
                  setDraftForm({ ...draftForm, host: e.target.value });
                  if (formErrors.host) setFormErrors({ ...formErrors, host: null });
                }}
              />
              {formErrors.host && (
                <p className="text-[11px] text-rose-500 mt-0.5">{formErrors.host}</p>
              )}
            </div>

            {/* Port Input */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Port <span className="text-rose-500">*</span>
              </label>
              <Input
                type="number"
                placeholder="443"
                value={draftForm.port ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDraftForm({ ...draftForm, port: isNaN(val) ? ('' as unknown as number) : val });
                  if (formErrors.port) setFormErrors({ ...formErrors, port: null });
                }}
              />
              {formErrors.port && (
                <p className="text-[11px] text-rose-500 mt-0.5">{formErrors.port}</p>
              )}
            </div>

            {/* MTProto Secret Input & SNI Badge Preview */}
            {draftForm.proxy_type === 'mtproto' && (
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>
                    MTProto Secret <span className="text-rose-500">*</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    Standard (32 hex), Obfuscated (dd...), or Fake-TLS (ee...)
                  </span>
                </label>
                <Input
                  type={showSecret ? 'text' : 'password'}
                  placeholder="32-char hex, dd..., or ee... Fake-TLS secret"
                  value={draftForm.secret || ''}
                  onChange={(e) => {
                    setDraftForm({ ...draftForm, secret: e.target.value });
                    if (formErrors.secret) setFormErrors({ ...formErrors, secret: null });
                  }}
                  trailingElement={
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1 hover:text-slate-900 dark:hover:text-white"
                      tabIndex={-1}
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
                {formErrors.secret && (
                  <p className="text-[11px] text-rose-500 mt-0.5">{formErrors.secret}</p>
                )}

                {/* Real-time SNI domain badge preview (UI-SPEC, 04-RESEARCH) */}
                {draftSecretClassification && draftSecretClassification.type === 'fake_tls_ee' && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <Badge
                      variant={draftSecretClassification.isValid ? 'emerald' : 'rose'}
                      size="sm"
                      icon={<ShieldCheck className="w-3 h-3" />}
                    >
                      Fake-TLS SNI Domain: {draftSecretClassification.tlsDomain || 'Invalid Domain Hex'}
                    </Badge>
                  </div>
                )}
                {draftSecretClassification && draftSecretClassification.type === 'obfuscated_dd' && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <Badge variant="sky" size="sm">
                      Obfuscated Secret (dd)
                    </Badge>
                  </div>
                )}
                {draftSecretClassification && draftSecretClassification.type === 'standard_mtproto' && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <Badge variant="slate" size="sm">
                      Standard MTProto Secret (32-hex)
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {/* SOCKS5 / HTTP Username & Password */}
            {draftForm.proxy_type !== 'mtproto' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Username (Optional)
                  </label>
                  <Input
                    placeholder="Proxy username"
                    value={draftForm.username || ''}
                    onChange={(e) => setDraftForm({ ...draftForm, username: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Password (Optional)
                  </label>
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Proxy password"
                    value={draftForm.password || ''}
                    onChange={(e) => setDraftForm({ ...draftForm, password: e.target.value })}
                    trailingElement={
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="p-1 hover:text-slate-900 dark:hover:text-white"
                        tabIndex={-1}
                        aria-label={showSecret ? 'Hide password' : 'Show password'}
                      >
                        {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    }
                  />
                </div>
              </>
            )}
          </div>

          {/* Test Diagnostic in Editor & Footer CTAs */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={
                  testingProxyIds['draft'] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Activity className="w-3.5 h-3.5" />
                  )
                }
                disabled={testingProxyIds['draft']}
                onClick={handleTestDraft}
              >
                {testingProxyIds['draft'] ? 'Testing Connection...' : 'Test Connection'}
              </Button>
              {renderLatencyBadge('draft')}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsEditorOpen(false);
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveProfile}
                disabled={isSaving}
              >
                {isSaving ? 'Saving Profile...' : 'Save Proxy Profile'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
