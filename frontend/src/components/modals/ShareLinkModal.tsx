import React, { useState, useEffect } from 'react';
import { Copy, Check, ShieldCheck, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../api';
import type { FileNode, ShareLinkInfo } from '../../types';

interface ShareLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetFile?: FileNode;
}

export const ShareLinkModal: React.FC<ShareLinkModalProps> = ({
  isOpen,
  onClose,
  targetFile,
}) => {
  const [shareInfo, setShareInfo] = useState<ShareLinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedApp, setCopiedApp] = useState(false);
  const [copiedTg, setCopiedTg] = useState(false);

  useEffect(() => {
    if (isOpen && targetFile) {
      setLoading(true);
      api
        .generateShareLink(targetFile.drive_id, targetFile.id)
        .then((info) => {
          setShareInfo(info);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen, targetFile]);

  const copyToClipboard = (text: string, type: 'app' | 'tg') => {
    navigator.clipboard.writeText(text);
    if (type === 'app') {
      setCopiedApp(true);
      setTimeout(() => setCopiedApp(false), 2000);
    } else {
      setCopiedTg(true);
      setTimeout(() => setCopiedTg(false), 2000);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Zero-Knowledge Share Link"
      subtitle="Generates end-to-end decryptable links anchored by Telegram MTProto channel messages"
      maxWidth="md"
    >
      {loading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
          <span className="text-xs text-slate-400 font-mono">Generating cryptographic anchor...</span>
        </div>
      ) : shareInfo ? (
        <div className="space-y-4">
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-300 leading-relaxed">
              {shareInfo.zero_knowledge_note ||
                'Anyone with this link and the shared decryption key can stream this file directly without passing plaintext to intermediate servers.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              ProtoFS Deep App Link
            </label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareInfo.protofs_app_link}
                className="w-full bg-slate-950 text-xs font-mono text-slate-200 rounded-xl px-3 py-2 border border-white/10"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyToClipboard(shareInfo.protofs_app_link, 'app')}
                icon={copiedApp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              >
                {copiedApp ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Direct Telegram Message Link
            </label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareInfo.telegram_message_link}
                className="w-full bg-slate-950 text-xs font-mono text-slate-200 rounded-xl px-3 py-2 border border-white/10"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyToClipboard(shareInfo.telegram_message_link, 'tg')}
                icon={copiedTg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              >
                {copiedTg ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-rose-400">Failed to generate share link</div>
      )}
    </Modal>
  );
};
