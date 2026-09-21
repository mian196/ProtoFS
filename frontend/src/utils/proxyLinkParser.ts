import type {
  FieldValidationResult,
  ParsedProxyResult,
  ProxyType,
  SecretClassificationInfo,
} from '../types';

/**
 * Decodes a hex string representing an ASCII/UTF-8 domain name (used in Fake-TLS secrets).
 */
export function decodeHexDomain(hex: string): string | null {
  if (!hex || hex.length === 0 || hex.length % 2 !== 0) {
    return null;
  }

  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }

  try {
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      if (byte === 0) {
        return null;
      }
      result += String.fromCharCode(byte);
    }

    // Validate that the decoded result looks like a valid hostname/SNI domain
    const cleaned = result.trim();
    if (/^[a-zA-Z0-9.-]+$/.test(cleaned) && cleaned.includes('.')) {
      return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Categorizes and validates an MTProto secret (standard, obfuscated dd, or Fake-TLS ee).
 */
export function classifySecret(secret: string): SecretClassificationInfo {
  const clean = (secret || '').trim();
  if (!clean) {
    return {
      type: 'invalid',
      label: 'Required',
      isValid: false,
    };
  }

  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    return {
      type: 'invalid',
      label: 'Invalid Hex Format',
      isValid: false,
    };
  }

  const lower = clean.toLowerCase();

  // Standard 32-char hex secret (16 bytes)
  if (lower.length === 32) {
    return {
      type: 'standard_mtproto',
      label: 'Standard MTProto',
      isValid: true,
    };
  }

  // Obfuscated secret with 'dd' prefix (17 bytes -> 34 hex chars)
  if (lower.startsWith('dd') && lower.length === 34) {
    return {
      type: 'obfuscated_dd',
      label: 'Obfuscated (dd)',
      isValid: true,
    };
  }

  // Fake-TLS secret with 'ee' prefix (17 bytes + domain hex)
  if (lower.startsWith('ee') && lower.length >= 36) {
    const domainHex = lower.substring(34);
    const domain = decodeHexDomain(domainHex);
    if (domain) {
      return {
        type: 'fake_tls_ee',
        label: 'Fake-TLS (ee)',
        tlsDomain: domain,
        isValid: true,
      };
    }
    return {
      type: 'fake_tls_ee',
      label: 'Fake-TLS (ee)',
      isValid: false,
    };
  }

  return {
    type: 'invalid',
    label: 'Invalid Secret Length',
    isValid: false,
  };
}

/**
 * Validates a host string (IPv4, IPv6, or domain name).
 */
export function validateHost(host: string): FieldValidationResult {
  const clean = (host || '').trim();
  if (!clean) {
    return { isValid: false, error: 'Host / IP address is required' };
  }

  // IPv4 validation
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  if (ipv4Regex.test(clean)) {
    return { isValid: true };
  }

  // IPv6 validation (bracketed or bare)
  const bareIpv6 = clean.startsWith('[') && clean.endsWith(']') ? clean.slice(1, -1) : clean;
  if (/^[0-9a-fA-F:]+$/.test(bareIpv6) && bareIpv6.includes(':')) {
    return { isValid: true };
  }

  // RFC 1123 Hostname validation
  const hostnameRegex =
    /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)*(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/;
  if (hostnameRegex.test(clean)) {
    return { isValid: true };
  }

  return { isValid: false, error: 'Invalid hostname or IP address' };
}

/**
 * Validates a port number (1-65535).
 */
export function validatePort(port: number | string): FieldValidationResult {
  const num = typeof port === 'string' ? parseInt(port.trim(), 10) : port;
  if (isNaN(num) || !Number.isInteger(num)) {
    return { isValid: false, error: 'Port must be a valid number' };
  }

  if (num < 1 || num > 65535) {
    return { isValid: false, error: 'Port must be between 1 and 65535' };
  }

  return { isValid: true };
}

/**
 * Validates an MTProto secret.
 */
export function validateSecret(secret: string): FieldValidationResult {
  const classification = classifySecret(secret);
  if (!classification.isValid) {
    return {
      isValid: false,
      error:
        classification.label === 'Required'
          ? 'Secret is required for MTProto proxy'
          : `Invalid MTProto secret (${classification.label})`,
    };
  }
  return { isValid: true };
}

/**
 * Validates full proxy form fields based on proxy type.
 */
export function validateProxyForm(fields: {
  proxyType: ProxyType;
  host: string;
  port: number | string;
  secret?: string;
  username?: string;
  password?: string;
}): Record<string, string | null> {
  const errors: Record<string, string | null> = {
    host: null,
    port: null,
    secret: null,
  };

  const hostCheck = validateHost(fields.host);
  if (!hostCheck.isValid) {
    errors.host = hostCheck.error || 'Invalid host';
  }

  const portCheck = validatePort(fields.port);
  if (!portCheck.isValid) {
    errors.port = portCheck.error || 'Invalid port';
  }

  if (fields.proxyType === 'mtproto') {
    const secretCheck = validateSecret(fields.secret || '');
    if (!secretCheck.isValid) {
      errors.secret = secretCheck.error || 'Invalid secret';
    }
  }

  return errors;
}

/**
 * Parses a Telegram proxy link (tg://proxy, tg://socks, https://t.me/proxy, https://t.me/socks, etc.).
 */
export function parseProxyLink(input: string): ParsedProxyResult {
  const raw = (input || '').trim();
  if (!raw) {
    return { isValid: false, error: 'Proxy link cannot be empty', rawLink: raw };
  }

  let type: ProxyType;
  let queryParams: URLSearchParams;

  try {
    // 1. Handle tg:// or tg: schemes
    if (/^tg:\/\/(proxy|socks)/i.test(raw) || /^tg:(proxy|socks)/i.test(raw)) {
      const isSocks = /^tg:\/\/(socks)|tg:(socks)/i.test(raw);
      type = isSocks ? 'socks5' : 'mtproto';

      const qIndex = raw.indexOf('?');
      if (qIndex !== -1) {
        queryParams = new URLSearchParams(raw.substring(qIndex + 1));
      } else {
        return {
          isValid: false,
          error: 'Missing query parameters in Telegram proxy URL',
          rawLink: raw,
        };
      }
    }
    // 2. Handle HTTP / HTTPS URLs (t.me, telegram.me, etc.)
    else if (/^https?:\/\/(t\.me|telegram\.me)\/(proxy|socks)/i.test(raw)) {
      const url = new URL(raw);
      const pathname = url.pathname.toLowerCase();
      if (pathname.includes('/socks')) {
        type = 'socks5';
      } else if (pathname.includes('/proxy')) {
        type = 'mtproto';
      } else {
        return {
          isValid: false,
          error: 'Unsupported Telegram proxy URL path',
          rawLink: raw,
        };
      }
      queryParams = url.searchParams;
    } else {
      return {
        isValid: false,
        error:
          'Unrecognized proxy link format. Expected tg://proxy, tg://socks, or https://t.me/proxy link',
        rawLink: raw,
      };
    }
  } catch (err) {
    return {
      isValid: false,
      error: `Failed to parse URL: ${err instanceof Error ? err.message : String(err)}`,
      rawLink: raw,
    };
  }

  if (!queryParams || !type) {
    return {
      isValid: false,
      error: 'Could not extract proxy parameters from link',
      rawLink: raw,
    };
  }

  // Extract server / host
  const rawServer = queryParams.get('server') || queryParams.get('host') || '';
  const host = decodeURIComponent(rawServer).trim();
  if (!host) {
    return {
      isValid: false,
      error: 'Missing required "server" parameter in proxy link',
      rawLink: raw,
    };
  }

  const hostCheck = validateHost(host);
  if (!hostCheck.isValid) {
    return {
      isValid: false,
      error: hostCheck.error || 'Invalid server host in proxy link',
      rawLink: raw,
    };
  }

  // Extract port
  const rawPort = queryParams.get('port') || '';
  if (!rawPort) {
    return {
      isValid: false,
      error: 'Missing required "port" parameter in proxy link',
      rawLink: raw,
    };
  }

  const port = parseInt(rawPort.trim(), 10);
  const portCheck = validatePort(port);
  if (!portCheck.isValid) {
    return {
      isValid: false,
      error: portCheck.error || 'Invalid port parameter in proxy link',
      rawLink: raw,
    };
  }

  if (type === 'mtproto') {
    const rawSecret = queryParams.get('secret') || '';
    const secret = decodeURIComponent(rawSecret).trim();
    if (!secret) {
      return {
        isValid: false,
        error: 'Missing required "secret" parameter in MTProto link',
        rawLink: raw,
      };
    }

    const classification = classifySecret(secret);
    if (!classification.isValid) {
      return {
        isValid: false,
        error: `Invalid MTProto secret in link (${classification.label})`,
        rawLink: raw,
      };
    }

    return {
      isValid: true,
      proxyType: 'mtproto',
      host,
      port,
      secret,
      tlsDomain: classification.tlsDomain,
      rawLink: raw,
    };
  }

  // SOCKS5 parameters
  const rawUser = queryParams.get('user') || queryParams.get('username') || '';
  const rawPass = queryParams.get('pass') || queryParams.get('password') || '';
  const username = rawUser ? decodeURIComponent(rawUser).trim() : undefined;
  const password = rawPass ? decodeURIComponent(rawPass) : undefined;

  return {
    isValid: true,
    proxyType: 'socks5',
    host,
    port,
    username: username || undefined,
    password: password || undefined,
    rawLink: raw,
  };
}
