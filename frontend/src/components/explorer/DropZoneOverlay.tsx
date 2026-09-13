import React from 'react';
import { Upload, Lock, HardDrive } from 'lucide-react';
import { Badge } from '../ui/Badge';

interface DropZoneOverlayProps {
  isDragging: boolean;
  isEncrypted?: boolean;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  isDragging,
  isEncrypted = false,
}) => {
  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-sky-400/80 rounded-3xl m-4 pointer-events-none animate-in fade-in duration-200 select-none">
      <div className="w-20 h-20 rounded-full bg-sky-500/20 border border-sky-400/50 flex items-center justify-center mb-4 animate-bounce">
        <Upload className="w-10 h-10 text-sky-400" />
      </div>
      <h2 className="text-xl font-bold text-white tracking-tight">
        {isEncrypted ? 'Drop files to encrypt & upload' : 'Drop files to upload'}
      </h2>
      <p className="text-sm text-slate-300 mt-1 max-w-sm text-center">
        {isEncrypted
          ? 'Files will be encrypted with your personal vault key before streaming.'
          : 'Files will be streamed directly to your Telegram channel storage.'}
      </p>
      <div className="mt-4">
        {isEncrypted ? (
          <Badge variant="emerald" size="md" icon={<Lock className="w-3.5 h-3.5" />}>
            Vault Encrypted Stream
          </Badge>
        ) : (
          <Badge variant="slate" size="md" icon={<HardDrive className="w-3.5 h-3.5" />}>
            Standard Cloud Storage
          </Badge>
        )}
      </div>
    </div>
  );
};
