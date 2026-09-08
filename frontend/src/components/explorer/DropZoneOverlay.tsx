import React from 'react';
import { Upload, Lock } from 'lucide-react';

interface DropZoneOverlayProps {
  isDragging: boolean;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({ isDragging }) => {
  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-sky-400/80 rounded-3xl m-4 pointer-events-none animate-in fade-in duration-200 select-none">
      <div className="w-20 h-20 rounded-full bg-sky-500/20 border border-sky-400/50 flex items-center justify-center mb-4 animate-bounce">
        <Upload className="w-10 h-10 text-sky-400" />
      </div>
      <h2 className="text-xl font-bold text-white tracking-tight">Drop files to encrypt & upload</h2>
      <p className="text-sm text-slate-300 mt-1 max-w-sm text-center">
        Files will be split into 64 KB authenticated chunks with independent AES-256-GCM IVs.
      </p>
      <div className="flex items-center gap-1.5 mt-4 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
        <Lock className="w-3.5 h-3.5" />
        <span>End-to-End Encrypted Stream</span>
      </div>
    </div>
  );
};
