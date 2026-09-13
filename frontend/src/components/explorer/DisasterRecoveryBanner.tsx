import React, { useState } from 'react';
import { Download, FileSpreadsheet, Trash2, Check, ShieldAlert } from 'lucide-react';
import { useDriveStore } from '../../stores/useDriveStore';
import type { DriveMetadata } from '../../types';

interface DisasterRecoveryBannerProps {
  drive: DriveMetadata;
}

export const DisasterRecoveryBanner: React.FC<DisasterRecoveryBannerProps> = ({ drive }) => {
  const { exportManifest, deleteDrive } = useDriveStore();
  const [isExporting, setIsExporting] = useState(false);
  const [downloadedFormat, setDownloadedFormat] = useState<string | null>(null);

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      setIsExporting(true);
      const data = await exportManifest(drive.id, format);
      const mime = format === 'json' ? 'application/json' : 'text/csv';
      const ext = format === 'json' ? 'json' : 'csv';
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${drive.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_manifest_recovery.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloadedFormat(format);
      setTimeout(() => setDownloadedFormat(null), 3000);
    } catch (err) {
      console.error('Failed to export manifest:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleUnlink = async () => {
    if (
      window.confirm(
        `Are you sure you want to unlink and remove '${drive.name}' from ProtoFS?\n\nTip: Make sure you exported the file list first if you need a record of your files.`
      )
    ) {
      await deleteDrive(drive.id);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-rose-500/10 p-4 backdrop-blur-md shadow-lg">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0 mt-0.5 md:mt-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-amber-400">
                Telegram Channel Inaccessible (Disaster Recovery Mode)
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-mono font-medium rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                READ-ONLY
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              The linked Telegram channel for <strong className="text-white">{drive.name}</strong> was deleted or is unreachable. ProtoFS has preserved your entire directory tree and file metadata in local SQLite cache.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end md:self-center shrink-0">
          <button
            onClick={() => handleExport('json')}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg transition-colors shadow-sm disabled:opacity-50"
            title="Export full file structure as JSON"
          >
            {downloadedFormat === 'json' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Export JSON</span>
          </button>

          <button
            onClick={() => handleExport('csv')}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg transition-colors shadow-sm disabled:opacity-50"
            title="Export file table as CSV"
          >
            {downloadedFormat === 'csv' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleUnlink}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors shadow-sm ml-1"
            title="Remove drive from ProtoFS"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Unlink</span>
          </button>
        </div>
      </div>
    </div>
  );
};
