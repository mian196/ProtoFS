import React from 'react';
import { AuthModal } from './AuthModal';
import { AccountManagerModal } from './AccountManagerModal';
import { DriveManagerModal } from './DriveManagerModal';
import { CreateFolderModal } from './CreateFolderModal';
import { RenameModal } from './RenameModal';
import { MoveModal } from './MoveModal';
import { ShareLinkModal } from './ShareLinkModal';
import { VersionHistoryModal } from './VersionHistoryModal';
import { SyncConfigModal } from './SyncConfigModal';
import { P2pTransferModal } from './P2pTransferModal';
import { SettingsModal } from './SettingsModal';
import { MediaPreviewModal } from '../preview/MediaPreviewModal';
import { ConflictModal } from './ConflictModal';
import { VaultUnlockModal } from '../settings/modals/VaultUnlockModal';
import { RecoveryPhraseModal } from '../settings/modals/RecoveryPhraseModal';
import { ClearCacheConfirmModal } from '../settings/modals/ClearCacheConfirmModal';
import { ExportBackupModal } from '../settings/modals/ExportBackupModal';
import { ImportBackupModal } from '../settings/modals/ImportBackupModal';
import { useModalStore } from '../../stores/useModalStore';
import { useAuthStore } from '../../stores/useAuthStore';
import type { ConflictState } from '../../hooks/useUploadManager';
import type { FileNode } from '../../types';

interface AppModalsProps {
  onDownloadFile: (file: FileNode) => Promise<void>;
  conflictState: ConflictState | null;
}

export const AppModals: React.FC<AppModalsProps> = ({
  onDownloadFile,
  conflictState,
}) => {
  const { session, isLoading: isAuthLoading } = useAuthStore();
  const { activeModal, payload, closeModal } = useModalStore();

  return (
    <>
      <AuthModal
        isOpen={(!isAuthLoading && !session) || activeModal === 'auth'}
        onClose={closeModal}
      />
      <AccountManagerModal
        isOpen={activeModal === 'accountManager'}
        onClose={closeModal}
      />
      <DriveManagerModal isOpen={activeModal === 'driveManager'} onClose={closeModal} />
      <CreateFolderModal isOpen={activeModal === 'createFolder'} onClose={closeModal} />
      <RenameModal
        isOpen={activeModal === 'rename'}
        onClose={closeModal}
        targetNode={payload.targetNode}
      />
      <MoveModal
        isOpen={activeModal === 'move'}
        onClose={closeModal}
        targetNode={payload.targetNode}
      />
      <ShareLinkModal
        isOpen={activeModal === 'shareLink'}
        onClose={closeModal}
        targetFile={payload.previewFile}
      />
      <VersionHistoryModal
        isOpen={activeModal === 'versionHistory'}
        onClose={closeModal}
        targetFile={payload.previewFile}
      />
      <SyncConfigModal isOpen={activeModal === 'syncConfig'} onClose={closeModal} />
      <P2pTransferModal isOpen={activeModal === 'p2pTransfer'} onClose={closeModal} />
      <SettingsModal isOpen={activeModal === 'settings'} onClose={closeModal} />
      <MediaPreviewModal
        isOpen={activeModal === 'preview'}
        onClose={closeModal}
        file={payload.previewFile || null}
        onDownload={onDownloadFile}
      />
      <VaultUnlockModal
        isOpen={activeModal === 'vaultUnlock'}
        onClose={closeModal}
        onSuccess={payload.onSuccess}
      />
      <RecoveryPhraseModal
        isOpen={activeModal === 'recoveryPhrase'}
        onClose={closeModal}
        initialMode={payload.recoveryMode ? 'recover' : 'export'}
        onSuccess={payload.onSuccess}
      />
      <ClearCacheConfirmModal
        isOpen={activeModal === 'clearCacheConfirm'}
        onClose={closeModal}
        onConfirm={payload.onSuccess}
        driveId={payload.targetDriveId}
      />
      <ExportBackupModal
        isOpen={activeModal === 'exportBackup'}
        onClose={closeModal}
      />
      <ImportBackupModal
        isOpen={activeModal === 'importBackup'}
        onClose={closeModal}
      />
      {conflictState && (
        <ConflictModal
          isOpen={conflictState.isOpen}
          existingNode={conflictState.existingNode}
          incomingFile={conflictState.incomingFile}
          remainingCount={conflictState.remainingCount}
          onResolve={conflictState.resolve}
          onClose={() => conflictState.resolve('skip', false)}
        />
      )}
    </>
  );
};
