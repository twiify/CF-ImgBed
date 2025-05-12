import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid'; // For generating key prefixes or parts of keys

// Re-define or import a more detailed ApiKey structure for server-side
interface ApiKeyRecord {
  id: string; // Unique ID for this key record
  name: string;
  userId: string; // User who owns this key
  keyPrefix: string; // e.g., "imgbed_pk_" (public part of the key)
  hashedKey: string; // Hash of the full secret key
  createdAt: string; // ISO string
  lastUsedAt?: string; // ISO string
  expiresAt?: string; // ISO string, optional
  permissions: string[]; // e.g., ['upload', 'delete']
  status: 'active' | 'revoked';
}

// --- Helper: Basic API Key Hashing (replace with a proper crypto library for production) ---
// In a real app, use something like bcrypt or Argon2 via Web Crypto API if available in CF Workers,
// or a library that supports it. For simplicity here, a placeholder.
// IMPORTANT: This is NOT cryptographically secure for passwords, but for API keys, 
// if the full key is high-entropy, even a simple hash can prevent direct DB leakage.
// However, constant-time comparison is still important for the actual validation.
async function simpleHash(data: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgUint8 = new TextEncoder().encode(data); // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  }
  // Fallback for environments without crypto.subtle (should not happen in modern CF Workers)
  // THIS IS VERY INSECURE, FOR DEMO ONLY
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `fallback_${hash.toString(16)}`;
}

// --- API Route Handlers ---

// GET: List API Keys for the authenticated user
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user; // locals.user is defined via middleware and App.Locals
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  try {
    // Keys are stored like: apikey_user:<userId>_id:<keyId>
    // Or, maintain an index: user:<userId>:apikeys = [keyId1, keyId2, ...]
    // For simplicity, let's list all keys and filter by userId (less efficient for many keys)
    const listResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
    const userApiKeys: Partial<ApiKeyRecord>[] = [];

    for (const key of listResult.keys) {
      const recordString = await IMGBED_KV.get(key.name);
      if (recordString) {
        const record = JSON.parse(recordString) as ApiKeyRecord;
        if (record.userId === user.userId && record.status === 'active') {
          // Only return non-sensitive parts
          userApiKeys.push({
            id: record.id,
            name: record.name,
            keyPrefix: record.keyPrefix,
            createdAt: record.createdAt,
            lastUsedAt: record.lastUsedAt,
            permissions: record.permissions,
          });
        }
      }
    }
    return new Response(JSON.stringify(userApiKeys), { status: 200 });
  } catch (e: any) {
    console.error('Error listing API keys:', e);
    return new Response(JSON.stringify({ error: 'Failed to retrieve API keys', details: e.message }), { status: 500 });
  }
};

// POST: Generate a new API Key
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user; // locals.user is defined via middleware and App.Locals
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  let payload: { name?: string; permissions?: string[] };
  try {
    payload = await request.json();
    if (!payload || typeof payload !== 'object') throw new Error('Invalid payload structure');
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body or payload structure' }), { status: 400 });
  }
  
  const keyName = typeof payload.name === 'string' ? payload.name.trim() : `API Key ${nanoid(5)}`;
  // Default permissions, can be extended later
  const permissions = Array.isArray(payload.permissions) ? payload.permissions : ['upload']; 

  const keyId = nanoid(16); // ID for the KV record (internal)
  const publicIdPart = nanoid(12); // Publicly visible part of the prefix
  const secretKeyPart = nanoid(32); // Secret part of the key, not stored directly

  const keyPrefix = `imgbed_sk_${publicIdPart}`; // Prefix shown in UI, e.g., imgbed_sk_abcdef123456
  const fullApiKey = `${keyPrefix}_${secretKeyPart}`; // This is shown to user once and is what they will use

  const hashedFullApiKey = await simpleHash(fullApiKey); // Hash the full API key for storage and comparison

  const newApiKeyRecord: ApiKeyRecord = {
    id: keyId, // Internal record ID
    name: keyName,
    userId: user.userId,
    keyPrefix, // The part of the key like imgbed_sk_xxxxxxxxxxxx
    hashedKey: hashedFullApiKey, // Hash of the *full* API key (prefix + secret part)
    createdAt: new Date().toISOString(),
    permissions,
    status: 'active',
  };

  try {
    // Store the main record
    await IMGBED_KV.put(`apikey_record:${keyId}`, JSON.stringify(newApiKeyRecord));
    // Store an index by the publicIdPart for faster lookup during validation
    // This maps the public part of the key prefix to the internal record ID
    await IMGBED_KV.put(`apikey_public_id:${publicIdPart}`, keyId);


    // Return the full API key *once* to the user. Also return the record details.
    return new Response(JSON.stringify({
      message: 'API Key generated successfully. Store it securely, it will not be shown again.',
      apiKey: fullApiKey, // The actual key
      record: { // Non-sensitive parts of the record for display
        id: newApiKeyRecord.id,
        name: newApiKeyRecord.name,
        keyPrefix: newApiKeyRecord.keyPrefix,
        createdAt: newApiKeyRecord.createdAt,
        permissions: newApiKeyRecord.permissions,
      }
    }), { status: 201 });

  } catch (e: any) {
    console.error('Error generating API key:', e);
    return new Response(JSON.stringify({ error: 'Failed to generate API key', details: e.message }), { status: 500 });
  }
};

// DELETE: Revoke an API Key
export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user; // locals.user is defined via middleware and App.Locals
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  let payload: { keyId?: string };
  try {
    payload = await request.json();
    if (!payload || typeof payload !== 'object') throw new Error('Invalid payload structure');
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body or payload structure' }), { status: 400 });
  }

  const keyIdToRevoke = payload.keyId;
  if (typeof keyIdToRevoke !== 'string' || !keyIdToRevoke) {
    return new Response(JSON.stringify({ error: 'Missing or invalid keyId' }), { status: 400 });
  }

  try {
    const recordKey = `apikey_record:${keyIdToRevoke}`;
    const recordString = await IMGBED_KV.get(recordKey);
    if (!recordString) {
      return new Response(JSON.stringify({ error: 'API Key not found' }), { status: 404 });
    }
    const record = JSON.parse(recordString) as ApiKeyRecord;

    // Ensure user can only revoke their own keys
    if (record.userId !== user.userId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    record.status = 'revoked';
    // Optionally, set an expiry for the revoked key record for cleanup later, or delete it.
    // For now, just mark as revoked.
    await IMGBED_KV.put(recordKey, JSON.stringify(record));
    
    return new Response(JSON.stringify({ message: 'API Key revoked successfully' }), { status: 200 });
  } catch (e: any) {
    console.error(`Error revoking API key ${keyIdToRevoke}:`, e);
    return new Response(JSON.stringify({ error: 'Failed to revoke API key', details: e.message }), { status: 500 });
  }
};
