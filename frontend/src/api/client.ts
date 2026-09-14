import { invoke, isTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useModalStore } from '../stores/useModalStore';

export interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export { isTauri };

/**
 * Intercepts common backend error patterns and surfaces actionable sonner toasts.
 */
export function interceptIpcError(command: string, errorMessage: string): void {
  console.error(`[IPC Error] ${command}:`, errorMessage);

  const lowerMsg = errorMessage.toLowerCase();

  // 1. Telegram Rate Limit / FLOOD_WAIT (UX-04, D-20)
  if (/flood_wait/i.test(errorMessage) || lowerMsg.includes('rate limit')) {
    const match = errorMessage.match(/flood_wait_?(\d+)/i);
    const waitSeconds = match ? parseInt(match[1], 10) : 60;
    toast.error('Telegram Rate Limit Active', {
      description: `Rate limit active (${waitSeconds}s cooldown). Background transfers paused.`,
      duration: 8000,
      action: {
        label: 'View Settings',
        onClick: () => useModalStore.getState().openModal('settings', { defaultTab: 'sync' }),
      },
    });
    return;
  }

  // 2. Vault Locked / Master Key Missing (UX-04, D-20)
  if (
    errorMessage.includes('VAULT_LOCKED') ||
    lowerMsg.includes('vault locked') ||
    lowerMsg.includes('master key is not unlocked') ||
    lowerMsg.includes('security vault is locked')
  ) {
    toast.error('Security Vault Locked', {
      description: 'Encryption vault is locked. Master key is required to access cloud files.',
      duration: 8000,
      action: {
        label: 'Unlock Vault',
        onClick: () => useModalStore.getState().openModal('vaultUnlock'),
      },
    });
    return;
  }

  // 3. Telegram Session Revoked / Auth Failure (UX-04, D-20)
  if (
    errorMessage.includes('AUTH_KEY_UNREGISTERED') ||
    lowerMsg.includes('session expired') ||
    lowerMsg.includes('session revoked')
  ) {
    toast.error('Session Revoked', {
      description: 'Your Telegram session has expired or was revoked. Please log in again.',
      duration: 10000,
      action: {
        label: 'Log In Again',
        onClick: () => useModalStore.getState().openModal('auth'),
      },
    });
    return;
  }

  // 4. WebDAV Mount Failed (UX-04, D-20)
  if (
    errorMessage.includes('WEBDAV_MOUNT_FAILED') ||
    lowerMsg.includes('drive letter') ||
    lowerMsg.includes('failed to mount virtual drive')
  ) {
    toast.error('WebDAV Mount Failed', {
      description: 'Could not mount drive letter. Letter or port may already be in use.',
      duration: 8000,
      action: {
        label: 'Open Settings',
        onClick: () => useModalStore.getState().openModal('settings', { defaultTab: 'webdav' }),
      },
    });
    return;
  }
}

/**
 * Standardized typed invocation for Tauri backend commands.
 * Automatically unwraps CommandResponse<T> envelopes, extracts backend error
 * strings, and normalizes errors into standard Error instances.
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri desktop runtime required for command: ${command}`);
  }

  try {
    const res = await invoke<CommandResponse<T>>(command, args);
    if (!res.success) {
      const errMsg = res.error || `Command ${command} failed with unknown error`;
      interceptIpcError(command, errMsg);
      throw new Error(errMsg);
    }
    // Handle void/unit () responses where data is null or undefined
    if (res.data === undefined && res.data !== null) {
      return undefined as unknown as T;
    }
    return res.data as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    interceptIpcError(command, message);
    throw new Error(message);
  }
}
