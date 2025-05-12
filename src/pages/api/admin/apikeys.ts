import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { simpleHash } from '~/lib/utils'; // Import shared simpleHash function

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

// --- API Route Handlers ---

// GET: List API Keys for the authenticated user
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('APIKeys GET: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // Performance consideration: Listing all keys and then filtering can be inefficient for a large number of total keys.
    // A more scalable approach would involve indexing keys by userId, e.g., using a prefix like `apikey_user:${user.userId}_record:`.
    // However, for simplicity with a moderate number of keys, listing and filtering is acceptable.
    const listResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
    const userApiKeys: Partial<ApiKeyRecord>[] = [];

    for (const kvKey of listResult.keys) {
      // Optimization: If status is available in metadata (from a previous optimization), use it.
      // This avoids a .get() call if the key is known to be revoked or doesn't match userId.
      // For now, we still need to .get() to check userId.
      const recordString = await IMGBED_KV.get(kvKey.name);
      if (recordString) {
        try {
          const record = JSON.parse(recordString) as ApiKeyRecord;
          if (record.userId === user.userId && record.status === 'active') {
            // Return only non-sensitive parts for listing
            userApiKeys.push({
              id: record.id,
              name: record.name,
              keyPrefix: record.keyPrefix,
              createdAt: record.createdAt,
              lastUsedAt: record.lastUsedAt,
              permissions: record.permissions,
              // status: record.status, // Optionally include status if needed by client
            });
          }
        } catch (parseError) {
          console.error(`APIKeys GET: Failed to parse API key record ${kvKey.name}:`, parseError);
          // Potentially skip this key or log an issue
        }
      }
    }
    return new Response(JSON.stringify(userApiKeys), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('APIKeys GET: Error listing API keys:', e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to retrieve API keys', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// POST: Generate a new API Key
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('APIKeys POST: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
    // Store the main record with metadata for optimized listing (e.g., for dashboard stats)
    await IMGBED_KV.put(
      `apikey_record:${keyId}`,
      JSON.stringify(newApiKeyRecord),
      { metadata: { status: newApiKeyRecord.status, userId: newApiKeyRecord.userId } }
    );
    
    // Store an index by the publicIdPart for faster lookup during API key validation
    await IMGBED_KV.put(`apikey_public_id:${publicIdPart}`, keyId);

    // Return the full API key *once* to the user.
    // Also return non-sensitive parts of the record for immediate display/use by the client.
    return new Response(JSON.stringify({
      message: 'API Key generated successfully. Store it securely, it will not be shown again.',
      apiKey: fullApiKey,
      record: {
        id: newApiKeyRecord.id,
        name: newApiKeyRecord.name,
        keyPrefix: newApiKeyRecord.keyPrefix,
        createdAt: newApiKeyRecord.createdAt,
        permissions: newApiKeyRecord.permissions,
        status: newApiKeyRecord.status, // Include status for client-side display consistency
      }
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('APIKeys POST: Error generating API key:', e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to generate API key', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// DELETE: Revoke an API Key
export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  
  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('APIKeys DELETE: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
    // Optionally, set an expiry for the revoked key record for automated cleanup later, or delete associated indexes.
    // For now, just update the status and its metadata.
    await IMGBED_KV.put(
      recordKey, 
      JSON.stringify(record),
      { metadata: { status: record.status, userId: record.userId } } // Update metadata as well
    );
    
    // If `apikey_public_id` index should be removed for revoked keys, do it here.
    // For now, it's kept, as `isValidApiKey` checks status.
    // await IMGBED_KV.delete(`apikey_public_id:${record.keyPrefix.split('_')[2]}`); // Example if keyPrefix was stored in record

    return new Response(JSON.stringify({ message: 'API Key revoked successfully' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error(`APIKeys DELETE: Error revoking API key ${keyIdToRevoke}:`, e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to revoke API key', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
