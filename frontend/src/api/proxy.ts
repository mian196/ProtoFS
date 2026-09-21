import { invokeCommand } from './client';
import type {
  ProxyConfig,
  ProxyDiagnosticResult,
  ProxyProfile,
  ProxyProfileSummary,
  ProxyStatusResponse,
} from '../types';

/**
 * Returns all saved proxy profiles as masked summaries for UI display.
 */
export async function getProxies(): Promise<ProxyProfileSummary[]> {
  return invokeCommand<ProxyProfileSummary[]>('get_proxies_command');
}

/**
 * Loads a single proxy profile by ID with decrypted secrets for editing.
 */
export async function getProxy(id: string): Promise<ProxyProfile | null> {
  return invokeCommand<ProxyProfile | null>('get_proxy_command', { id });
}

/**
 * Creates or updates a proxy profile, storing credentials securely.
 */
export async function saveProxy(profile: ProxyProfile): Promise<void> {
  return invokeCommand<void>('save_proxy_command', { profile });
}

/**
 * Deletes a proxy profile and purges its stored credentials.
 */
export async function deleteProxy(id: string): Promise<void> {
  return invokeCommand<void>('delete_proxy_command', { id });
}

/**
 * Sets the active proxy profile ID or clears the active proxy.
 */
export async function setActiveProxy(id: string | null): Promise<void> {
  return invokeCommand<void>('set_active_proxy_command', { id });
}

/**
 * Toggles the global proxy enabled state.
 */
export async function toggleProxyEnabled(enabled: boolean): Promise<void> {
  return invokeCommand<void>('toggle_proxy_enabled_command', { enabled });
}

/**
 * Tests proxy reachability and measures round-trip latency to Telegram servers.
 */
export async function testProxyConnection(
  draftConfig?: ProxyConfig | null,
  targetDc?: number | null
): Promise<ProxyDiagnosticResult> {
  return invokeCommand<ProxyDiagnosticResult>('test_proxy_connection_command', {
    draftConfig: draftConfig ?? undefined,
    targetDc: targetDc ?? undefined,
  });
}

/**
 * Returns the overall proxy status including active profile and total count.
 */
export async function getProxyStatus(): Promise<ProxyStatusResponse> {
  return invokeCommand<ProxyStatusResponse>('get_proxy_status_command');
}

export const proxyApi = {
  getProxies,
  getProxy,
  saveProxy,
  deleteProxy,
  setActiveProxy,
  toggleProxyEnabled,
  testProxyConnection,
  getProxyStatus,
};
