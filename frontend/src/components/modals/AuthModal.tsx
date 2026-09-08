import React, { useState, useEffect } from 'react';
import { QrCode, Phone, KeyRound, Loader2 } from 'lucide-react';
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

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { setSession, requires2fa, setRequires2fa, setPhoneCodeHash } = useAuthStore();

  const [mode, setMode] = useState<'qr' | 'phone'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(0);

  // Phone form
  const [phone, setPhone] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [code, setCode] = useState('');
  const [password2fa, setPassword2fa] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);

  // QR Polling loop
  useEffect(() => {
    let timer: number;
    let isCancelled = false;

    if (isOpen && mode === 'qr' && !requires2fa) {
      const fetchQr = async () => {
        try {
          const qr = await api.loginRequestQr(apiId || '12345', apiHash || 'hash');
          if (isCancelled) return;
          setQrTimeLeft(qr.expires_in_sec);
          const dataUrl = await QRCode.toDataURL(qr.token_url || 'protofs://auth', {
            margin: 1,
            width: 220,
          });
          if (!isCancelled) setQrDataUrl(dataUrl);

          // Polling status
          const checkStatus = async () => {
            if (isCancelled) return;
            try {
              const status = await api.loginCheckQr(apiId || '12345', apiHash || 'hash');
              if (status.status === 'success' && status.session) {
                setSession(status.session);
                onClose();
              } else if (status.status === 'requires_2fa') {
                setRequires2fa(true);
              } else if (status.status === 'waiting_scan') {
                timer = window.setTimeout(checkStatus, 2000);
              }
            } catch (err) {
              console.warn('QR check error:', err);
            }
          };

          checkStatus();
        } catch (err: any) {
          if (!isCancelled) setError(err.message || 'Failed to start QR login');
        }
      };

      fetchQr();
    }

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, mode, requires2fa, apiId, apiHash, setRequires2fa, setSession, onClose]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const hash = await api.loginSendCode(phone, apiId, apiHash);
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
    try {
      const res = await api.loginVerifyCode(phone, apiId, apiHash, code);
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
    try {
      const res = await api.loginVerify2Fa(apiId, apiHash, password2fa);
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
              <span>Phone / API</span>
            </button>
          </div>

          {/* QR Mode */}
          {mode === 'qr' ? (
            <div className="flex flex-col items-center justify-center py-4 space-y-4 text-center">
              {qrDataUrl ? (
                <div className="p-3 bg-white rounded-2xl shadow-xl">
                  <img src={qrDataUrl} alt="Telegram Login QR" className="w-48 h-48" />
                </div>
              ) : (
                <div className="w-48 h-48 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                  <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-slate-200 font-medium">
                  Open Telegram on your phone → Settings → Devices → Link Desktop Device
                </p>
                <p className="text-[11px] font-mono text-slate-400">
                  QR Token expires in: {qrTimeLeft}s
                </p>
              </div>

              {error && <div className="text-xs font-mono text-rose-400">{error}</div>}
            </div>
          ) : (
            /* Phone Mode */
            <form onSubmit={codeSent ? handleVerifyCode : handleSendCode} className="space-y-3.5">
              {!codeSent ? (
                <>
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
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        API ID (Optional)
                      </label>
                      <Input
                        type="text"
                        placeholder="my.telegram.org"
                        value={apiId}
                        onChange={(e) => setApiId(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        API Hash (Optional)
                      </label>
                      <Input
                        type="password"
                        placeholder="hash"
                        value={apiHash}
                        onChange={(e) => setApiHash(e.target.value)}
                      />
                    </div>
                  </div>
                </>
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
