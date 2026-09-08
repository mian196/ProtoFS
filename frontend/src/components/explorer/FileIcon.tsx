import React from 'react';
import {
  Folder,
  FileVideo,
  FileAudio,
  FileImage,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileCode,
  File,
  Lock,
} from 'lucide-react';
import type { FileNode } from '../../types';

interface FileIconProps {
  kind: 'folder' | 'file';
  fileType?: FileNode['type'];
  fileName?: string;
  isEncrypted?: boolean;
  className?: string;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({
  kind,
  fileType = 'binary',
  fileName = '',
  isEncrypted = false,
  className = 'w-6 h-6',
  size = 24,
}) => {
  if (kind === 'folder') {
    return <Folder className={`text-sky-400 fill-sky-500/20 ${className}`} size={size} />;
  }

  // Extension check if fileType is generic
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const renderIcon = () => {
    switch (fileType) {
      case 'video':
        return <FileVideo className={`text-purple-400 ${className}`} size={size} />;
      case 'audio':
        return <FileAudio className={`text-emerald-400 ${className}`} size={size} />;
      case 'image':
        return <FileImage className={`text-pink-400 ${className}`} size={size} />;
      case 'pdf':
        return <FileText className={`text-rose-400 ${className}`} size={size} />;
      case 'sheet':
        return <FileSpreadsheet className={`text-green-400 ${className}`} size={size} />;
      case 'presentation':
        return <Presentation className={`text-amber-400 ${className}`} size={size} />;
      case 'doc':
        if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'json', 'html', 'css', 'toml'].includes(ext)) {
          return <FileCode className={`text-cyan-400 ${className}`} size={size} />;
        }
        return <FileText className={`text-blue-400 ${className}`} size={size} />;
      default:
        if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'json', 'html', 'css', 'toml'].includes(ext)) {
          return <FileCode className={`text-cyan-400 ${className}`} size={size} />;
        }
        return <File className={`text-slate-400 ${className}`} size={size} />;
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      {renderIcon()}
      {isEncrypted && (
        <span className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-slate-950 border border-emerald-500/40 text-emerald-400">
          <Lock className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
};
