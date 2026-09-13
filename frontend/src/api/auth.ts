import { invokeCommand, isTauri } from './client';
import { mockStorage } from './mock';
import type { AuthResponse, AuthSession, QrStatusResponse } from '../types';

export async function getSessionStatus(): Promise<AuthSession | null> {
  if (isTauri()) {
    try {
      const data = await invokeCommand<AuthSession | null>('get_session_status');
      mockStorage.setSession(data);
      return data;
    } catch (err) {
      console.warn('Tauri get_session_status failed, checking local cache:', err);
    }
  }
  return mockStorage.getSession();
}

export async function loginSendCode(phone: string, apiId: string, apiHash: string): Promise<string> {
  if (isTauri()) {
    return invokeCommand<string>('login_send_code', { phone, apiId, apiHash });
  }
  throw new Error('ProtoFS requires the desktop Tauri runtime for MTProto operations.');
}

export async function loginVerifyCode(
  phone: string,
  apiId: string,
  apiHash: string,
  code: string
): Promise<AuthResponse> {
  if (isTauri()) {
    const res = await invokeCommand<AuthResponse>('login_verify_code', { phone, apiId, apiHash, code });
    if (res.session) {
      mockStorage.setSession(res.session);
    }
    return res;
  }

  // Web fallback
  const session: AuthSession = {
    is_authenticated: true,
    phone,
    api_id: apiId,
    api_hash: apiHash,
    username: 'protofs_user',
    first_name: 'ProtoFS User',
    user_id: 11100000,
    active_drive_id: 'personal',
  };
  mockStorage.setSession(session);
  return { session, requires_2fa: false };
}

export async function loginVerify2fa(
  apiId: string,
  apiHash: string,
  password: string
): Promise<AuthResponse> {
  if (isTauri()) {
    const res = await invokeCommand<AuthResponse>('login_verify_2fa', { apiId, apiHash, password });
    if (res.session) {
      mockStorage.setSession(res.session);
    }
    return res;
  }

  const session: AuthSession = {
    is_authenticated: true,
    phone: '+11100000000',
    api_id: apiId,
    api_hash: apiHash,
    username: 'protofs_user',
    first_name: 'ProtoFS User',
    user_id: 11100000,
    active_drive_id: 'personal',
  };
  mockStorage.setSession(session);
  return { session, requires_2fa: false };
}

export async function loginRequestQr(apiId: string, apiHash: string): Promise<QrStatusResponse> {
  if (isTauri()) {
    return invokeCommand<QrStatusResponse>('login_request_qr', { apiId, apiHash });
  }
  throw new Error('ProtoFS requires the desktop Tauri runtime for MTProto operations.');
}

export async function loginCheckQr(apiId: string, apiHash: string): Promise<QrStatusResponse> {
  if (isTauri()) {
    const res = await invokeCommand<QrStatusResponse>('login_check_qr', { apiId, apiHash });
    if (res.session) {
      mockStorage.setSession(res.session);
    }
    return res;
  }

  return {
    token_url: '',
    expires_in_sec: 0,
    status: 'waiting_scan',
    session: null,
  };
}

export async function logout(): Promise<void> {
  if (isTauri()) {
    try {
      await invokeCommand<void>('logout_command');
    } catch (err) {
      console.warn('Tauri logout error:', err);
    }
  }
  mockStorage.clearAll();
}

export async function listAccounts(): Promise<AuthSession[]> {
  if (isTauri()) {
    try {
      const accounts = await invokeCommand<AuthSession[]>('list_accounts_command');
      mockStorage.setAccounts(accounts);
      return accounts;
    } catch (err) {
      console.warn('Tauri list_accounts_command error:', err);
    }
  }
  const cached = mockStorage.getAccounts();
  if (cached.length > 0) return cached;
  const active = await getSessionStatus();
  return active ? [active] : [];
}

export async function switchAccount(userId: number): Promise<AuthSession> {
  if (isTauri()) {
    const res = await invokeCommand<AuthSession>('switch_account_command', { userId });
    mockStorage.setSession(res);
    return res;
  }

  const accounts = await listAccounts();
  const target = accounts.find((a) => a.user_id === userId);
  if (!target) throw new Error('Account not found');
  mockStorage.setSession(target);
  return target;
}

export async function removeAccount(userId: number): Promise<AuthSession | null> {
  if (isTauri()) {
    const res = await invokeCommand<AuthSession | null>('remove_account_command', { userId });
    mockStorage.setSession(res);
    return res;
  }

  let accounts = await listAccounts();
  accounts = accounts.filter((a) => a.user_id !== userId);
  mockStorage.setAccounts(accounts);
  const next = accounts[0] || null;
  mockStorage.setSession(next);
  return next;
}

export const authApi = {
  getSessionStatus,
  loginSendCode,
  loginVerifyCode,
  loginVerify2fa,
  loginVerify2Fa: loginVerify2fa,
  loginRequestQr,
  loginCheckQr,
  logout,
  listAccounts,
  switchAccount,
  removeAccount,
};
