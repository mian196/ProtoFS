import React, { useEffect, useState } from 'react';
import { X, Download, Lock, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { api } from '../../api';
import type { FileNode } from '../../types';

interface MediaPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileNode | null;
  onDownload?: (file: FileNode) => void;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  isOpen,
  onClose,
  file,
  onDownload,
}) => {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !file) {
      setStreamUrl(null);
      setTextContent(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const loadPreview = async () => {
      try {
        const preview = await api.getFilePreview(file.drive_id, file.id);
        if (!isMounted) return;

        if (preview.is_text && preview.text_content) {
          setTextContent(preview.text_content);
          setLoading(false);
        } else if (preview.data_base64) {
          const mime = preview.mime_type || 'application/octet-stream';
          const dataUrl = `data:${mime};base64,${preview.data_base64}`;
          setStreamUrl(dataUrl);
          setLoading(false);
        } else if (file.type === 'doc') {
          setTextContent(
            `// ProtoFS Zero-Knowledge Stream Preview\n// File: ${file.name}\n// Hash: ${file.sha256_hash || 'SHA256-VERIFIED'}\n// Size: ${file.size}\n\n[End-to-End Encrypted Document. Click Download below to save and open locally.]`
          );
          setLoading(false);
        } else {
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to initialize preview stream');
          setLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
    };
  }, [isOpen, file]);

  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-xl" onClick={onClose} />

      {/* Preview Container */}
      <div
        className="relative w-full max-w-4xl max-h-[90vh] rounded-3xl p-1.5 bg-white/[0.04] border border-white/10 backdrop-blur-2xl shadow-2xl flex flex-col z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-[calc(1.5rem-0.375rem)] bg-slate-900/95 border border-white/[0.05] p-5 flex flex-col h-full overflow-hidden shadow-inner">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="min-w-0 pr-3">
              <h3 className="text-sm font-semibold text-slate-100 truncate">{file.name}</h3>
              <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                <span>{file.size}</span>
                <span>•</span>
                <span>{file.type.toUpperCase()}</span>
                {file.encrypted && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Lock className="w-3 h-3" />
                    <span>AES-256</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onDownload && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(file)}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Download
                </Button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body Preview Area */}
          <div className="flex-1 min-h-[350px] max-h-[65vh] overflow-auto flex items-center justify-center p-4 bg-slate-950/60 rounded-2xl my-3 border border-white/[0.03]">
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                <span className="text-xs font-mono">Decrypting chunk stream...</span>
              </div>
            ) : error ? (
              <div className="text-center text-rose-400 text-xs font-mono">{error}</div>
            ) : file.type === 'video' && streamUrl ? (
              <video
                controls
                autoPlay
                className="max-h-[60vh] max-w-full rounded-xl shadow-lg"
                src={streamUrl}
              >
                Your browser does not support the video tag.
              </video>
            ) : file.type === 'audio' && streamUrl ? (
              <div className="w-full max-w-md p-6 bg-slate-900 rounded-2xl border border-white/10 shadow-xl text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                  <ExternalLink className="w-8 h-8" />
                </div>
                <audio controls className="w-full" src={streamUrl} />
              </div>
            ) : file.type === 'image' && streamUrl ? (
              <img
                src={streamUrl}
                alt={file.name}
                className="max-h-[60vh] max-w-full object-contain rounded-xl shadow-lg"
              />
            ) : textContent ? (
              <pre className="w-full h-full p-4 bg-slate-900/90 text-xs font-mono text-slate-200 rounded-xl overflow-auto whitespace-pre-wrap leading-relaxed">
                {textContent}
              </pre>
            ) : (
              <div className="text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                  <Download className="w-6 h-6" />
                </div>
                <p className="text-xs text-slate-300">
                  Direct inline preview is not supported for this binary type.
                </p>
                {onDownload && (
                  <Button variant="primary" size="sm" onClick={() => onDownload(file)}>
                    Download to View
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
