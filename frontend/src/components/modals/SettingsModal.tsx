import React, { useState } from 'react';
import { Trash2, ShieldCheck, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useThemeStore, type ThemePalette } from '../../stores/useThemeStore';
import { api } from '../../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { theme, setTheme } = useThemeStore();
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const themeOptions: { id: ThemePalette; name: string; desc: string; color: string }[] = [
    {
      id: 'nordic',
      name: 'Nordic Frost',
      desc: 'Deep OLED Navy substrate with Electric Ice Blue accents',
      color: '#38BDF8',
    },
    {
      id: 'cyberpunk',
      name: 'Cyberpunk Neon',
      desc: 'OLED Black with Neon Mint and Aviation Rose',
      color: '#00F5D4',
    },
    {
      id: 'forest',
      name: 'Forest Slate',
      desc: 'Subdued Pine substrate with Emerald accents',
      color: '#10B981',
    },
    {
      id: 'obsidian',
      name: 'Obsidian Amber',
      desc: 'Warm Obsidian substrate with Golden Amber accents',
      color: '#F59E0B',
    },
  ];

  const handleClearWalCache = async () => {
    setClearingCache(true);
    try {
      await api.clearVirtualDriveCache('personal');
      setClearingCache(false);
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2500);
    } catch {
      setClearingCache(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Settings & System Preferences"
      subtitle="Configure themes, SQLite WAL cache eviction, and zero-knowledge encryption parameters"
      maxWidth="lg"
    >
      <div className="space-y-6">
        {/* Color Palette Selector */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-200">
            UI Color Palette (WCAG AA High-Contrast)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {themeOptions.map((t) => (
              <div
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                  theme === t.id
                    ? 'bg-white/[0.06] border-sky-400/50 shadow-md'
                    : 'bg-slate-950/60 border-white/5 hover:border-white/15'
                }`}
              >
                <div
                  className="w-5 h-5 rounded-full shrink-0 mt-0.5 border border-white/20 flex items-center justify-center"
                  style={{ backgroundColor: t.color }}
                >
                  {theme === t.id && <Check className="w-3 h-3 text-slate-950 stroke-[3]" />}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">{t.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SQLite Cache Maintenance */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-200">Local SQLite WAL Cache</p>
              <p className="text-[11px] text-slate-400">
                Clears unpinned chunk files and resets the local memory-mapped database cache.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearWalCache}
              disabled={clearingCache}
              icon={
                cacheCleared ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )
              }
            >
              {cacheCleared ? 'Cleared' : clearingCache ? 'Cleaning...' : 'Clear Cache'}
            </Button>
          </div>
        </div>

        {/* Security Summary */}
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            ProtoFS Core uses Argon2id key derivation and AES-256-GCM 64 KB chunk authenticated stream encryption. Master keys never touch network sockets in plaintext.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
};
