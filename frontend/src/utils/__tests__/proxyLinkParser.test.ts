import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  classifySecret,
  decodeHexDomain,
  parseProxyLink,
  validateHost,
  validatePort,
  validateProxyForm,
  validateSecret,
} from '../proxyLinkParser';

describe('decodeHexDomain', () => {
  it('should decode valid hex ascii string into domain', () => {
    // 'www.google.com' in hex: 7777772e676f6f676c652e636f6d
    const decoded = decodeHexDomain('7777772e676f6f676c652e636f6d');
    assert.equal(decoded, 'www.google.com');
  });

  it('should decode yandex.ru in hex', () => {
    // 'yandex.ru' in hex: 79616e6465782e7275
    const decoded = decodeHexDomain('79616e6465782e7275');
    assert.equal(decoded, 'yandex.ru');
  });

  it('should return null for invalid hex strings', () => {
    assert.equal(decodeHexDomain('not-a-hex'), null);
    assert.equal(decodeHexDomain('123'), null); // Odd length
    assert.equal(decodeHexDomain(''), null);
  });

  it('should return null if decoded text is not a valid domain with a dot', () => {
    // 'localhost' in hex: 6c6f63616c686f7374 (no dot)
    assert.equal(decodeHexDomain('6c6f63616c686f7374'), null);
  });
});

describe('classifySecret', () => {
  it('should identify standard 32-hex MTProto secrets', () => {
    const res = classifySecret('0123456789abcdef0123456789abcdef');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'standard_mtproto');
    assert.equal(res.label, 'Standard MTProto');
    assert.equal(res.tlsDomain, undefined);
  });

  it('should identify dd-prefix obfuscated secrets', () => {
    const res = classifySecret('dd0123456789abcdef0123456789abcdef');
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'obfuscated_dd');
    assert.equal(res.label, 'Obfuscated (dd)');
    assert.equal(res.tlsDomain, undefined);
  });

  it('should identify ee-prefix Fake-TLS secrets with extracted domain', () => {
    const secret = 'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d';
    const res = classifySecret(secret);
    assert.equal(res.isValid, true);
    assert.equal(res.type, 'fake_tls_ee');
    assert.equal(res.label, 'Fake-TLS (ee)');
    assert.equal(res.tlsDomain, 'www.google.com');
  });

  it('should reject invalid secrets', () => {
    assert.equal(classifySecret('').isValid, false);
    assert.equal(classifySecret('short').isValid, false);
    assert.equal(classifySecret('0123456789abcdef0123456789abcdefgg').isValid, false); // invalid hex
    assert.equal(classifySecret('ee0123456789abcdef0123456789abcdef').isValid, false); // truncated ee
  });
});

describe('validateHost & validatePort & validateSecret', () => {
  it('should validate valid IPv4 addresses', () => {
    assert.equal(validateHost('1.2.3.4').isValid, true);
    assert.equal(validateHost('192.168.1.1').isValid, true);
    assert.equal(validateHost('149.154.167.50').isValid, true);
  });

  it('should validate valid IPv6 addresses', () => {
    assert.equal(validateHost('::1').isValid, true);
    assert.equal(validateHost('[2001:db8::1]').isValid, true);
  });

  it('should validate valid domain names', () => {
    assert.equal(validateHost('proxy.example.com').isValid, true);
    assert.equal(validateHost('mtproto.telegram.org').isValid, true);
    assert.equal(validateHost('my-host.internal').isValid, true);
  });

  it('should reject invalid hosts', () => {
    assert.equal(validateHost('').isValid, false);
    assert.equal(validateHost('   ').isValid, false);
    assert.equal(validateHost('invalid host name with spaces').isValid, false);
  });

  it('should validate ports in 1-65535 range', () => {
    assert.equal(validatePort(80).isValid, true);
    assert.equal(validatePort(443).isValid, true);
    assert.equal(validatePort('1080').isValid, true);
    assert.equal(validatePort(65535).isValid, true);
    assert.equal(validatePort(1).isValid, true);
  });

  it('should reject out-of-range or invalid ports', () => {
    assert.equal(validatePort(0).isValid, false);
    assert.equal(validatePort(-1).isValid, false);
    assert.equal(validatePort(65536).isValid, false);
    assert.equal(validatePort('abc').isValid, false);
  });

  it('should validate valid and invalid secrets with validateSecret', () => {
    assert.equal(validateSecret('0123456789abcdef0123456789abcdef').isValid, true);
    assert.equal(validateSecret('invalid-secret').isValid, false);
    assert.equal(validateSecret('').isValid, false);
  });
});

describe('parseProxyLink', () => {
  it('should parse standard tg://proxy MTProto links', () => {
    const link =
      'tg://proxy?server=149.154.167.50&port=443&secret=0123456789abcdef0123456789abcdef';
    const parsed = parseProxyLink(link);

    assert.equal(parsed.isValid, true);
    assert.equal(parsed.proxyType, 'mtproto');
    assert.equal(parsed.host, '149.154.167.50');
    assert.equal(parsed.port, 443);
    assert.equal(parsed.secret, '0123456789abcdef0123456789abcdef');
    assert.equal(parsed.tlsDomain, undefined);
  });

  it('should parse https://t.me/proxy Fake-TLS link with domain extraction', () => {
    const link =
      'https://t.me/proxy?server=proxy.google.com&port=8443&secret=ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d';
    const parsed = parseProxyLink(link);

    assert.equal(parsed.isValid, true);
    assert.equal(parsed.proxyType, 'mtproto');
    assert.equal(parsed.host, 'proxy.google.com');
    assert.equal(parsed.port, 8443);
    assert.equal(
      parsed.secret,
      'ee0123456789abcdef0123456789abcdef7777772e676f6f676c652e636f6d'
    );
    assert.equal(parsed.tlsDomain, 'www.google.com');
  });

  it('should parse https://telegram.me/proxy obfuscated link', () => {
    const link =
      'https://telegram.me/proxy?server=10.0.0.1&port=443&secret=dd0123456789abcdef0123456789abcdef';
    const parsed = parseProxyLink(link);

    assert.equal(parsed.isValid, true);
    assert.equal(parsed.proxyType, 'mtproto');
    assert.equal(parsed.host, '10.0.0.1');
    assert.equal(parsed.port, 443);
    assert.equal(parsed.secret, 'dd0123456789abcdef0123456789abcdef');
  });

  it('should parse tg://socks links without authentication', () => {
    const link = 'tg://socks?server=192.168.1.50&port=1080';
    const parsed = parseProxyLink(link);

    assert.equal(parsed.isValid, true);
    assert.equal(parsed.proxyType, 'socks5');
    assert.equal(parsed.host, '192.168.1.50');
    assert.equal(parsed.port, 1080);
    assert.equal(parsed.username, undefined);
    assert.equal(parsed.password, undefined);
  });

  it('should parse https://t.me/socks links with user and pass', () => {
    const link =
      'https://t.me/socks?server=socks.proxy.org&port=9050&user=admin&pass=secret%20123';
    const parsed = parseProxyLink(link);

    assert.equal(parsed.isValid, true);
    assert.equal(parsed.proxyType, 'socks5');
    assert.equal(parsed.host, 'socks.proxy.org');
    assert.equal(parsed.port, 9050);
    assert.equal(parsed.username, 'admin');
    assert.equal(parsed.password, 'secret 123');
  });

  it('should handle lenient whitespace trimming', () => {
    const link =
      '   tg://proxy?server=1.1.1.1&port=443&secret=0123456789abcdef0123456789abcdef   ';
    const parsed = parseProxyLink(link);
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.host, '1.1.1.1');
  });

  it('should return structured errors on invalid/malformed inputs', () => {
    assert.equal(parseProxyLink('').isValid, false);
    assert.equal(parseProxyLink('https://not-telegram.com/proxy?server=1.2.3.4').isValid, false);
    assert.equal(
      parseProxyLink('tg://proxy?port=443&secret=0123456789abcdef0123456789abcdef').isValid,
      false
    ); // missing server
    assert.equal(
      parseProxyLink('tg://proxy?server=1.2.3.4&secret=0123456789abcdef0123456789abcdef').isValid,
      false
    ); // missing port
    assert.equal(
      parseProxyLink('tg://proxy?server=1.2.3.4&port=443&secret=invalid').isValid,
      false
    ); // invalid secret
  });
});

describe('validateProxyForm', () => {
  it('should return no errors for a valid MTProto form', () => {
    const errors = validateProxyForm({
      proxyType: 'mtproto',
      host: '1.2.3.4',
      port: 443,
      secret: '0123456789abcdef0123456789abcdef',
    });

    assert.equal(errors.host, null);
    assert.equal(errors.port, null);
    assert.equal(errors.secret, null);
  });

  it('should return errors for missing host and invalid port', () => {
    const errors = validateProxyForm({
      proxyType: 'socks5',
      host: '',
      port: 70000,
    });

    assert.ok(errors.host);
    assert.ok(errors.port);
  });
});
