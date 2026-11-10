import React, { useState, useEffect } from 'react';
import { Copy, Check, ShieldCheck, Loader2, Download, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { api } from '../../api';
import { useDriveStore } from '../../stores/useDriveStore';
import { useVfsStore } from '../../stores/useVfsStore';
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
  const { activeDrive } = useDriveStore();
  const { currentParentId, loadDirectory } = useVfsStore();

  const [mode, setMode] = useState<'share' | 'import'>(targetFile ? 'share' : 'import');
  const [shareInfo, setShareInfo] = useState<ShareLinkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedApp, setCopiedApp] = useState(false);
  const [copiedTg, setCopiedTg] = useState(false);

  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setMode(targetFile ? 'share' : 'import');
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

  const handleImportLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrl.trim() || !activeDrive) return;
    setImporting(true);
    try {
      const imported = await api.importSharedLink(
        importUrl.trim(),
        activeDrive.id,
        currentParentId,
      );
      toast.success('Shared File Imported', {
        description: `${imported?.name || 'Shared file'} added to current directory.`,
      });
      await loadDirectory(activeDrive.id, currentParentId);
      setImportUrl('');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to import shared link', { description: msg });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'share' ? 'Share Encrypted Link' : 'Import Shared Link'}
      subtitle="Zero-knowledge protofs:// deep links anchored to Telegram storage"
      maxWidth="md"
    >
      <div className="space-y-4">
        {targetFile && (
          <div className="flex p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setMode('share')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                mode === 'share'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Share "{targetFile.name}"
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                mode === 'import'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Import External Link
            </button>
          </div>
        )}

        {mode === 'import' ? (
          <form onSubmit={handleImportLink} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Paste a <code className="font-mono text-sky-500">protofs://share?...</code> link
              </label>
              <div className="relative flex items-center">
                <Link2 className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="protofs://share?c=-100192837465&m=1042&n=file.pdf&s=1024&e=1"
                  className="w-full bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-slate-200 rounded-xl pl-9 pr-3 py-2.5 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!importUrl.trim() || importing}
                icon={<Download className="w-3.5 h-3.5" />}
              >
                {importing ? 'Importing...' : 'Import to Current Folder'}
              </Button>
            </div>
          </form>
        ) : loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Generating cryptographic anchor...
            </span>
          </div>
        ) : shareInfo ? (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                {shareInfo.zero_knowledge_note ||
                  'Anyone with this link and the shared decryption key can stream this file directly without passing plaintext to intermediate servers.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                ProtoFS Deep App Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareInfo.protofs_app_link}
                  className="w-full bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-800 dark:text-slate-200 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(shareInfo.protofs_app_link, 'app')}
                  icon={
                    copiedApp ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )
                  }
                >
                  {copiedApp ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Direct Telegram Message Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareInfo.telegram_message_link}
                  className="w-full bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-800 dark:text-slate-200 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-800"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(shareInfo.telegram_message_link, 'tg')}
                  icon={
                    copiedTg ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )
                  }
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
          <div className="py-4 text-center text-xs text-rose-500">
            Failed to generate share link
          </div>
        )}
      </div>
    </Modal>
  );
};
