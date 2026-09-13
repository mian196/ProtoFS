import { invoke, isTauri } from '@tauri-apps/api/core';

export interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export { isTauri };

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
      throw new Error(res.error || `Command ${command} failed with unknown error`);
    }
    // Handle void/unit () responses where data is null or undefined
    if (res.data === undefined && res.data !== null) {
      return undefined as unknown as T;
    }
    return res.data as T;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[IPC Error] ${command}:`, message);
    throw new Error(message);
  }
}
