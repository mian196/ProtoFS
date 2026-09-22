import React from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Download, CheckCircle2, Sparkles, ExternalLink, Box } from 'lucide-react';
import type { UpdateInfo } from '../../../types';

export interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
}) => {
  if (!updateInfo) return null;

  const isUpdate = updateInfo.update_available;

  const handleDownload = () => {
    if (updateInfo.download_url) {
      window.open(updateInfo.download_url, '_blank');
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isUpdate ? 'Software Update Available' : 'ProtoFS is Up to Date'}
      subtitle={
        isUpdate
          ? `A new version of ProtoFS is ready for installation.`
          : `You are running the latest stable release.`
      }
      maxWidth="md"
    >
      <div className="space-y-4">
        {isUpdate ? (
          <>
            {/* Version Transition Banner */}
            <div className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300 font-medium">
                  <Sparkles className="w-4 h-4 text-sky-500" />
                  <span>Version Upgrade</span>
                </div>
                {updateInfo.package_type && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300">
                    <Box className="w-3 h-3" />
                    {updateInfo.package_type}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  v{updateInfo.current_version}
                </div>
                <span className="text-slate-400 font-bold">→</span>
                <div className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-xs font-bold shadow-sm shadow-sky-500/20">
                  v{updateInfo.latest_version} (Latest)
                </div>
              </div>
            </div>

            {/* Asset Details */}
            {updateInfo.asset_name && (
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                <span className="truncate font-mono">{updateInfo.asset_name}</span>
                {updateInfo.asset_size_bytes && (
                  <span className="shrink-0 font-medium text-slate-500 ml-2">
                    {formatBytes(updateInfo.asset_size_bytes)}
                  </span>
                )}
              </div>
            )}

            {/* Release Highlights */}
            <div className="space-y-2">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Release Highlights ({updateInfo.release_date})
              </h5>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 max-h-48 overflow-y-auto text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans">
                {updateInfo.release_notes}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Remind Me Later
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDownload}
                icon={<Download className="w-3.5 h-3.5" />}
              >
                Download Update
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Up to Date State */}
            <div className="p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 mb-1">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  You are up to date!
                </h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80 mt-1">
                  ProtoFS v{updateInfo.current_version} is currently the latest available release.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <span>{updateInfo.channel || 'Stable Release Channel'}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => window.open(updateInfo.download_url, '_blank')}
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-400 hover:underline"
              >
                <span>View GitHub Releases</span>
                <ExternalLink className="w-3 h-3" />
              </button>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
