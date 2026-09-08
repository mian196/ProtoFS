import React, { useState, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ProgressBar } from '../ui/ProgressBar';
import { api } from '../../api';
import { useNativeStore } from '../../stores/useNativeStore';
import QRCode from 'qrcode';

interface P2pTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const P2pTransferModal: React.FC<P2pTransferModalProps> = ({ isOpen, onClose }) => {
  const { p2pStatus, loadNativeStatus } = useNativeStore();
  const [mode, setMode] = useState<'send' | 'receive'>('send');
  const [pinCode, setPinCode] = useState('');
  const [peerAddress, setPeerAddress] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadNativeStatus();
    }
  }, [isOpen, loadNativeStatus]);

  useEffect(() => {
    if (p2pStatus?.active_session?.qr_payload) {
      QRCode.toDataURL(p2pStatus.active_session.qr_payload, { margin: 1, width: 200 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    }
  }, [p2pStatus]);

  const handleStartReceiver = async () => {
    setLoading(true);
    try {
      await api.startP2pSession('receiver');
      await loadNativeStatus();
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  const handleConnectPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerAddress || !pinCode) return;
    setLoading(true);
    try {
      await api.connectP2pPeer(peerAddress, pinCode);
      await loadNativeStatus();
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Wi-Fi Direct P2P Transfer"
      subtitle="Ultra-fast LAN peer-to-peer file sharing with cryptographic PIN verification"
      maxWidth="md"
    >
      <div className="space-y-4">
        <div className="flex rounded-xl p-1 bg-slate-950 border border-white/5">
          <button
            onClick={() => setMode('send')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'send' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Receive from Peer
          </button>
          <button
            onClick={() => setMode('receive')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === 'receive' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'text-slate-400'
            }`}
          >
            Connect to Peer
          </button>
        </div>

        {mode === 'send' ? (
          <div className="space-y-4 text-center">
            {p2pStatus?.active_session ? (
              <div className="p-4 rounded-2xl bg-slate-950 border border-white/5 space-y-3">
                {qrDataUrl && (
                  <div className="p-2 bg-white rounded-xl inline-block shadow-lg">
                    <img src={qrDataUrl} alt="P2P QR" className="w-40 h-40" />
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-xs text-slate-300 font-mono">
                    Local IP: <span className="text-white font-bold">{p2pStatus.local_ip}:{p2pStatus.default_port}</span>
                  </p>
                  <p className="text-xs text-slate-300 font-mono">
                    Security PIN: <span className="text-emerald-400 font-bold text-sm tracking-widest">{p2pStatus.active_session.pin_code}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-6 space-y-3">
                <p className="text-xs text-slate-300 max-w-xs mx-auto">
                  Start a local listener to receive files directly from another device on your local network.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStartReceiver}
                  disabled={loading}
                  icon={<Download className="w-4 h-4" />}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Local Receiver'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleConnectPeer} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Peer IP & Port
              </label>
              <Input
                placeholder="192.168.1.50:4242"
                value={peerAddress}
                onChange={(e) => setPeerAddress(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Security PIN Code
              </label>
              <Input
                type="text"
                placeholder="6-digit PIN"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                required
              />
            </div>
            <Button variant="primary" size="sm" type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect & Transfer'}
            </Button>
          </form>
        )}

        {/* Live P2P Transfers */}
        {p2pStatus && p2pStatus.recent_transfers.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/5">
            <p className="text-[11px] font-mono uppercase text-slate-400">P2P Transfers</p>
            {p2pStatus.recent_transfers.map((tx) => (
              <div key={tx.transfer_id} className="p-2.5 rounded-xl bg-slate-950/80 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-200 truncate">{tx.file_name}</span>
                  <span className="text-slate-400 font-mono text-[10px]">{tx.formatted_speed}</span>
                </div>
                <ProgressBar progress={tx.progress_percent} height="sm" color="emerald" />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
