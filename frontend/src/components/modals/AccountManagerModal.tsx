import React, { useEffect } from 'react';
import {
  User,
  Wifi,
  WifiOff,
  RefreshCw,
  Plus,
  Check,
  Trash2,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAuthStore } from '../../stores/useAuthStore';
import { useModalStore } from '../../stores/useModalStore';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore } from '../../stores/useVfsStore';
import type { AuthSession } from '../../types';

interface AccountManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountManagerModal: React.FC<AccountManagerModalProps> = ({ isOpen, onClose }) => {
  const {
    session,
    accounts,
    connectionStatus,
    loadAccounts,
    switchAccount,
    removeAccount,
    checkConnection,
    logout,
  } = useAuthStore();
  const { openModal } = useModalStore();
  const { loadDrives } = useDriveStore();
  const { loadDirectory } = useVfsStore();

  useEffect(() => {
    if (isOpen) {
      loadAccounts();
      checkConnection();
    }
  }, [isOpen, loadAccounts, checkConnection]);

  const handleSwitch = async (userId: number) => {
    await switchAccount(userId);
    await loadDrives();
    loadDirectory('personal', 'root');
    onClose();
  };

  const handleAddNewAccount = () => {
    onClose();
    openModal('auth');
  };

  const isOnline = connectionStatus === 'connected';
  const isChecking = connectionStatus === 'checking';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Telegram Account & Network Status"
      subtitle="Manage linked Telegram sessions and MTProto connectivity"
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Active Account Profile Card */}
        {session && (
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-xl flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-400/40 text-sky-400 flex items-center justify-center font-bold text-base shrink-0 shadow-lg">
              {session.first_name ? session.first_name[0].toUpperCase() : <User className="w-6 h-6" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white truncate">
                  {session.first_name || 'Telegram User'}
                </h4>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400">
                  Active
                </span>
              </div>

              <p className="text-xs text-sky-300 font-mono mt-0.5">
                {session.username ? `@${session.username.replace(/^@/, '')}` : '@no_username'}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400 mt-2">
                <span>ID: {session.user_id}</span>
                <span>Phone: {session.phone || 'N/A'}</span>
                <span>Drive: {session.active_drive_id}</span>
              </div>
            </div>
          </div>
        )}

        {/* Telegram Connection & ISP Health */}
        <div
          className={`p-3.5 rounded-2xl border transition-all ${
            isOnline
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {isOnline ? (
                <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <div>
                <p className="text-xs font-semibold">
                  {isChecking
                    ? 'Checking Telegram MTProto connection...'
                    : isOnline
                    ? 'Connected to Telegram Network'
                    : 'Offline / Telegram Blocked'}
                </p>
                <p className="text-[10px] opacity-80 font-mono">
                  {isOnline
                    ? 'MTProto transport active • Zero-Knowledge Channel Sync Ready'
                    : 'Telegram is blocked in your region/ISP. Please enable a VPN or Proxy.'}
                </p>
              </div>
            </div>

            <button
              onClick={() => checkConnection()}
              disabled={isChecking}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
              title="Re-test Telegram connection"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>

          {!isOnline && !isChecking && (
            <div className="mt-2.5 pt-2.5 border-t border-rose-500/20 flex items-start gap-2 text-[11px] text-rose-200 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span>
                <strong>VPN Recommendation:</strong> If you are in a country with Telegram restrictions, connect to your system VPN (or WireGuard/Cloudflare WARP) and click the refresh button.
              </span>
            </div>
          )}
        </div>

        {/* Multi-Account Switcher */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Saved Telegram Accounts ({accounts.length})
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddNewAccount}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Add Account
            </Button>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
            {accounts.map((acc: AuthSession) => {
              const isCurrent = session?.user_id === acc.user_id;
              return (
                <div
                  key={acc.user_id}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                    isCurrent
                      ? 'bg-sky-500/15 border-sky-500/30 text-white'
                      : 'bg-slate-950/60 border-white/5 hover:bg-white/5 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center font-bold text-xs">
                      {acc.first_name ? acc.first_name[0].toUpperCase() : 'U'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{acc.first_name || 'Account'}</p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">
                        {acc.username ? `@${acc.username.replace(/^@/, '')}` : acc.phone} • ID: {acc.user_id}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isCurrent ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 text-[10px] font-mono font-semibold">
                        <Check className="w-3 h-3" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSwitch(acc.user_id)}
                      >
                        Switch
                      </Button>
                    )}

                    {accounts.length > 1 && (
                      <button
                        onClick={() => removeAccount(acc.user_id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/10"
                        title="Remove saved account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              logout();
              onClose();
            }}
            icon={<LogOut className="w-3.5 h-3.5" />}
          >
            Log Out Current
          </Button>

          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
