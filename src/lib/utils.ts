import type { ApiKeyRecord } from "./consts";

export function escapeHtml(unsafe: string): string {
  if (typeof unsafe !== 'string') return '';
  return unsafe.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Creates a Set-Cookie header string for session management.
 * @param sessionId The session ID to store in the cookie.
 * @param requestUrl The URL of the current request, used to determine if 'Secure' attribute should be set.
 * @param maxAgeSeconds The maximum age of the cookie in seconds. Defaults to 7 days.
 * @returns A string formatted for the Set-Cookie header.
 */
export function createSessionCookie(sessionId: string, requestUrl: URL, maxAgeSeconds: number = 7 * 24 * 60 * 60): string {
  const isSecureContext = requestUrl.protocol === 'https:';
  const cookieName = isSecureContext ? '__Secure-sid' : 'sid';
  const expires = new Date();
  expires.setTime(expires.getTime() + maxAgeSeconds * 1000);

  const attributes = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Expires=${expires.toUTCString()}`
  ];

  if (isSecureContext) {
    attributes.push('Secure');
  }

  return `${cookieName}=${sessionId}; ${attributes.join('; ')}`;
}

/**
 * Generates a SHA-256 hash of the input data string.
 * Prefers Web Crypto API if available, otherwise falls back to a VERY insecure simple hash.
 * IMPORTANT: The fallback is NOT cryptographically secure and is intended for environments
 * where Web Crypto might be unexpectedly unavailable. Production systems should ensure
 * Web Crypto (crypto.subtle) is available (standard in modern Cloudflare Workers).
 * @param data The string to hash.
 * @returns A Promise that resolves to the hex-encoded SHA-256 hash string.
 */
export async function simpleHash(data: string): Promise<string> {
  // Prefer Web Crypto API for SHA-256 hashing if available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgUint8 = new TextEncoder().encode(data); // Encode string to Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8); // Perform SHA-256 digest
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // Convert buffer to byte array
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // Convert bytes to hex string
  }
  // Fallback to a simple non-cryptographic hash if Web Crypto API is not available
  // WARNING: This fallback is NOT cryptographically secure.
  console.warn('Web Crypto API (crypto.subtle) not available. Falling back to insecure simpleHash. This should not happen in a standard Cloudflare Worker environment.');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `fallback_sha256_${hash.toString(16)}`; // Prefix to indicate fallback and algorithm
}


// --- Helper Functions ---

export async function isValidApiKeyInternal(apiKeyFromHeader: string | null, kv: KVNamespace): Promise<false | Pick<ApiKeyRecord, 'userId' | 'id'>> {
  if (!apiKeyFromHeader) {
    return false;
  }
  const parts = apiKeyFromHeader.split('_');
  if (parts.length !== 4 || parts[0] !== 'imgbed' || parts[1] !== 'sk') {
    console.warn('Invalid API key format received.');
    return false;
  }
  const publicIdPart = parts[2];
  const recordIdNullable = await (kv as any).get(`apikey_public_id:${publicIdPart}`, { type: "text", consistency: "strong" });
  if (!recordIdNullable) {
    console.warn(`No API key record found for publicId: ${publicIdPart}`);
    return false;
  }
  const recordId = recordIdNullable;

  const recordStringNullable = await (kv as any).get(`apikey_record:${recordId}`, { type: "text", consistency: "strong" });
  if (!recordStringNullable) {
    console.warn(`API key record not found for recordId: ${recordId} (inconsistent state)`);
    return false;
  }
  const recordString = recordStringNullable;

  try {
    const record = JSON.parse(recordString) as ApiKeyRecord;
    const hashedApiKeyFromHeader = await simpleHash(apiKeyFromHeader);
    if (record.status === 'active' && record.hashedKey === hashedApiKeyFromHeader) {
      if (record.permissions.includes('upload')) {
        const updatedRecord = { ...record, lastUsedAt: new Date().toISOString() };
        kv.put(`apikey_record:${recordId}`, JSON.stringify(updatedRecord))
          .catch(err => console.error(`Failed to update lastUsedAt for API key ${recordId}:`, err));
        return { userId: record.userId, id: record.id };
      } else {
        console.warn(`API key ${recordId} lacks 'upload' permission.`);
      }
    } else {
      if (record.status !== 'active') console.warn(`API key ${recordId} is not active (status: ${record.status}).`);
      if (record.hashedKey !== hashedApiKeyFromHeader) console.warn(`API key ${recordId} hash mismatch.`);
    }
  } catch (e) {
    console.error(`Error parsing API key record ${recordId}:`, e);
  }
  return false;
}