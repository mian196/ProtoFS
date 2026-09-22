import React, { useState, useEffect } from 'react';
import { Sun, HardDrive, FolderSync, ShieldCheck, Globe, Layers, Radio } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { GeneralTab } from '../settings/GeneralTab';
import { DrivesTab } from '../settings/DrivesTab';
import { SyncTab } from '../settings/SyncTab';
import { SecurityTab } from '../settings/SecurityTab';
import { WebDavTab } from '../settings/WebDavTab';
import { AdvancedTab } from '../settings/AdvancedTab';
import { ProxyTab } from '../settings/ProxyTab';
import { useModalStore, type SettingsTabId } from '../../stores/useModalStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Sun className="w-4 h-4" /> },
  { id: 'drives', label: 'Drives', icon: <HardDrive className="w-4 h-4" /> },
  { id: 'sync', label: 'Folder Sync', icon: <FolderSync className="w-4 h-4" /> },
  { id: 'security', label: 'Security & Keys', icon: <ShieldCheck className="w-4 h-4" /> },
  { id: 'webdav', label: 'WebDAV Drive', icon: <Globe className="w-4 h-4" /> },
  { id: 'proxy', label: 'Proxy', icon: <Radio className="w-4 h-4" /> },
  { id: 'advanced', label: 'Advanced & Cache', icon: <Layers className="w-4 h-4" /> },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { payload } = useModalStore();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');

  useEffect(() => {
    if (payload?.defaultTab) {
      setActiveTab(payload.defaultTab);
    }
  }, [payload?.defaultTab, isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="System Settings & Preferences"
      subtitle="Configure appearance, security keys, WebDAV mounting, and background synchronization"
      maxWidth="3xl"
    >
      <div className="flex flex-col md:flex-row gap-5 min-h-[460px]">
        {/* Mobile Horizontal Pill Strip (<768px) */}
        <div className="flex md:hidden overflow-x-auto gap-1.5 pb-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400 font-semibold border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Desktop Vertical Sidebar (w-52) */}
        <div className="hidden md:flex md:flex-col w-52 shrink-0 space-y-1 pr-4 border-r border-slate-200 dark:border-slate-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left w-full ${
                activeTab === tab.id
                  ? 'bg-sky-500/10 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 font-semibold border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60 font-normal'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content Panel */}
        <div className="flex-1 min-w-0 max-h-[520px] overflow-y-auto pr-1">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'drives' && <DrivesTab />}
          {activeTab === 'sync' && <SyncTab />}
          {activeTab === 'security' && <SecurityTab />}
          {activeTab === 'webdav' && <WebDavTab />}
          {activeTab === 'proxy' && <ProxyTab />}
          {activeTab === 'advanced' && <AdvancedTab />}
        </div>
      </div>

      <div className="flex justify-end pt-3 mt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
};
