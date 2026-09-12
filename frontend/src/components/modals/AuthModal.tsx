import React, { useState, useEffect, useCallback } from 'react';
import { QrCode, Phone, KeyRound, Loader2, RefreshCw, Key } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { api } from '../../api';
import { useAuthStore } from '../../stores/useAuthStore';
import QRCode from 'qrcode';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_API_ID = '2040';
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { setSession, requires2fa, setRequires2fa, setPhoneCodeHash } = useAuthStore();

  const [mode, setMode] = useState<'qr' | 'phone'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(0);
  const [qrLoading, setQrLoading] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  // API Credentials
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  // Phone form
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password2fa, setPassword2fa] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);

  // Fetch QR Code helper
  const generateQr = useCallback(async () => {
    setQrLoading(true);
    setError(null);
    setQrDataUrl(null);
    const targetApiId = apiId.trim() || DEFAULT_API_ID;
    const targetApiHash = apiHash.trim() || DEFAULT_API_HASH;

    try {
      const qr = await api.loginRequestQr(targetApiId, targetApiHash);
      setQrTimeLeft(qr.expires_in_sec);
      const dataUrl = await QRCode.toDataURL(qr.token_url || 'tg://login', {
        margin: 1,
        width: 220,
      });
      setQrDataUrl(dataUrl);
      setQrLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to generate Telegram QR code');
      setQrLoading(false);
    }
  }, [apiId, apiHash]);

  // QR Polling loop
  useEffect(() => {
    let timer: number;
    let isCancelled = false;

    if (isOpen && mode === 'qr' && !requires2fa) {
      generateQr();

      const targetApiId = apiId.trim() || DEFAULT_API_ID;
      const targetApiHash = apiHash.trim() || DEFAULT_API_HASH;

      const checkStatus = async () => {
        if (isCancelled) return;
        try {
          const status = await api.loginCheckQr(targetApiId, targetApiHash);
          if (status.status === 'success' && status.session) {
            setSession(status.session);
            onClose();
            return;
          } else if (status.status === 'requires_2fa') {
            setRequires2fa(true);
            return;
          } else if (status.status === 'waiting_scan') {
            if (status.token_url) {
              const dataUrl = await QRCode.toDataURL(status.token_url, {
                margin: 1,
                width: 220,
              });
              if (!isCancelled) setQrDataUrl(dataUrl);
            }
            if (status.expires_in_sec) {
              setQrTimeLeft(status.expires_in_sec);
            }
          }
        } catch (err) {
          console.warn('QR check error:', err);
        }
        if (!isCancelled) {
          timer = window.setTimeout(checkStatus, 2500);
        }
      };

      // Start check polling after initial request
      timer = window.setTimeout(checkStatus, 3000);
    }

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, mode, requires2fa, retryCount, generateQr, apiId, apiHash, setRequires2fa, setSession, onClose]);

  // Countdown timer for QR expiration
  useEffect(() => {
    if (qrTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setQrTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [qrTimeLeft]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const targetApiId = apiId.trim() || DEFAULT_API_ID;
    const targetApiHash = apiHash.trim() || DEFAULT_API_HASH;
    try {
      const hash = await api.loginSendCode(phone, targetApiId, targetApiHash);
      setPhoneCodeHash(hash);
      setCodeSent(true);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to send login code');
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const targetApiId = apiId.trim() || DEFAULT_API_ID;
    const targetApiHash = apiHash.trim() || DEFAULT_API_HASH;
    try {
      const res = await api.loginVerifyCode(phone, targetApiId, targetApiHash, code);
      if (res.session) {
        setSession(res.session);
        onClose();
      } else if (res.requires_2fa) {
        setRequires2fa(true);
      }
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setLoading(false);
    }
  };

  const handleVerify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const targetApiId = apiId.trim() || DEFAULT_API_ID;
    const targetApiHash = apiHash.trim() || DEFAULT_API_HASH;
    try {
      const res = await api.loginVerify2Fa(targetApiId, targetApiHash, password2fa);
      if (res.session) {
        setSession(res.session);
        onClose();
      }
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Incorrect 2FA password');
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Telegram MTProto Authentication"
      subtitle="Connect your account to access zero-knowledge encrypted channels"
      maxWidth="md"
    >
      {/* 2FA Form */}
      {requires2fa ? (
        <form onSubmit={handleVerify2fa} className="space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2.5 text-xs text-amber-300">
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>Two-Step Verification (Cloud Password) required.</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Cloud Password
            </label>
            <Input
              type="password"
              placeholder="Enter your 2FA password"
              value={password2fa}
              onChange={(e) => setPassword2fa(e.target.value)}
              required
              autoFocus
            />
          </div>

          {error && <div className="text-xs font-mono text-rose-400">{error}</div>}

          <Button variant="primary" type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unlock Session'}
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          {/* Mode Switcher */}
          <div className="flex rounded-xl p-1 bg-slate-950/80 border border-white/5">
            <button
              onClick={() => {
                setMode('qr');
                setError(null);
                setRetryCount((c) => c + 1);
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                mode === 'qr' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span>QR Code (Fast)</span>
            </button>
            <button
              onClick={() => {
                setMode('phone');
                setError(null);
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                mode === 'phone' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
              }`}
            >
              <Phone className="w-4 h-4" />
              <span>Phone Number</span>
            </button>
          </div>

          {/* Telegram App Credentials (Shown First in both modes) */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Key className="w-3.5 h-3.5 text-sky-400" />
              <span>Telegram API Credentials</span>
              <span className="text-[10px] text-slate-400 font-normal ml-auto">(from my.telegram.org)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  API ID (App ID)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 1234567"
                  value={apiId}
                  onChange={(e) => setApiId(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400 mt-1">Here goes your App API ID</p>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  API Hash
                </label>
                <Input
                  type="text"
                  placeholder="e.g. 0123456789abcdef..."
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400 mt-1">Here goes your App API Hash</p>
              </div>
            </div>
          </div>

          {/* QR Mode */}
          {mode === 'qr' ? (
            <div className="flex flex-col items-center justify-center py-2 space-y-4 text-center">
              <div className="flex items-center justify-between w-full px-1">
                <span className="text-xs text-slate-300 font-medium">Scan QR with Telegram</span>
                <button
                  onClick={() => setRetryCount((c) => c + 1)}
                  disabled={qrLoading}
                  className="inline-flex items-center gap-1.5 text-[11px] text-sky-400 hover:text-sky-300 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${qrLoading ? 'animate-spin' : ''}`} />
                  <span>Generate / Refresh</span>
                </button>
              </div>

              {qrLoading ? (
                <div className="w-48 h-48 bg-white/5 rounded-2xl flex flex-col items-center justify-center border border-white/10 gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                  <span className="text-[11px] text-slate-400">Connecting to MTProto...</span>
                </div>
              ) : qrDataUrl ? (
                <div className="p-3 bg-white rounded-2xl shadow-xl transition-all duration-300 hover:scale-[1.02]">
                  <img src={qrDataUrl} alt="Telegram Login QR" className="w-48 h-48" />
                </div>
              ) : (
                <div className="w-48 h-48 bg-white/5 rounded-2xl flex flex-col items-center justify-center border border-white/10 gap-2">
                  <QrCode className="w-8 h-8 text-slate-500" />
                  <span className="text-[11px] text-slate-400">Click Generate / Refresh</span>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-slate-200 font-medium">
                  Open Telegram on phone → Settings → Devices → Link Desktop Device
                </p>
                {qrTimeLeft > 0 && (
                  <p className="text-[11px] font-mono text-slate-400">
                    QR Token expires in: <span className="text-sky-400 font-semibold">{qrTimeLeft}s</span>
                  </p>
                )}
              </div>

              {error && (
                <div className="space-y-2 w-full max-w-sm">
                  <div className="text-xs font-mono text-rose-400 bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20 text-left">
                    {error}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setRetryCount((c) => c + 1)}
                  >
                    Retry Connection
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Phone Mode */
            <form onSubmit={codeSent ? handleVerifyCode : handleSendCode} className="space-y-3.5">
              {!codeSent ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Phone Number (International format)
                  </label>
                  <Input
                    type="tel"
                    placeholder="+1234567890"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Include country code, e.g. +1... or +44...
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Telegram Login Code
                  </label>
                  <Input
                    type="text"
                    placeholder="12345"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoFocus
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Check your Telegram app messages for the login code.
                  </p>
                </div>
              )}

              {error && <div className="text-xs font-mono text-rose-400">{error}</div>}

              <Button variant="primary" type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : codeSent ? (
                  'Verify & Log In'
                ) : (
                  'Send Login Code'
                )}
              </Button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
};

