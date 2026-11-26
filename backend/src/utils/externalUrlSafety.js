import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

function stripIpv6Brackets(value) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

// Native prefix matching also handles expanded and zero-padded IPv6 literals.
// Public HTTPS sources use ordinary global unicast, excluding special-use blocks.
const globalUnicastV6 = new BlockList();
globalUnicastV6.addSubnet('2000::', 3, 'ipv6');
const specialUseV6 = new BlockList();
for (const [prefix, length] of [
  ['2001::', 23],     // IETF assignments, including Teredo and benchmarking
  ['2001:db8::', 32], // Documentation
  ['2002::', 16],     // 6to4 transition addresses
  ['3fff::', 20],     // Documentation
]) {
  specialUseV6.addSubnet(prefix, length, 'ipv6');
}

function isPublicIpv6(address) {
  return !address.includes('%') && globalUnicastV6.check(address, 'ipv6') && !specialUseV6.check(address, 'ipv6');
}

export function isPublicIpAddress(address) {
  const normalized = stripIpv6Brackets(String(address || ''));
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export function parseExternalHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('Webhook URL must be a valid HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('Webhook URL must use standard HTTPS without embedded credentials.');
  }

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Webhook URL must use a public hostname.');
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error('Webhook URL cannot target a private or reserved network.');
  }
  return parsed;
}

export async function assertSafeExternalHttpsUrl(value) {
  const parsed = parseExternalHttpsUrl(value);
  if (!isIP(stripIpv6Brackets(parsed.hostname))) {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
      throw new Error('Webhook hostname does not resolve exclusively to public addresses.');
    }
  }
  return parsed.toString();
}
