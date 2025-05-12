import type { APIRoute } from 'astro';

// Expected structure for API key metadata when listing keys
interface ApiKeyMetadata {
  status?: 'active' | 'revoked'; 
  // Add other fields like userId if needed for more detailed stats directly from metadata
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('IMGBED_KV is not available. Check environment bindings.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV namespace not found.' }), { status: 500 });
  }

  try {
    // Get total image count by listing all keys with the 'image:' prefix
    const imageListResult = await IMGBED_KV.list({ prefix: 'image:' });
    const totalImageCount = imageListResult.keys.length;

    // Get active API Key count
    // This optimized approach relies on API key status being stored in the KV key's metadata
    // during API key creation/update. This avoids fetching each key's full record.
    const apiKeyListResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
    let activeApiKeyCount = 0;
    
    for (const key of apiKeyListResult.keys) {
      const metadata = key.metadata as ApiKeyMetadata | undefined;
      if (metadata && metadata.status === 'active') {
        activeApiKeyCount++;
      }
      // If metadata is not available or doesn't contain status, this key won't be counted as active here.
      // This implies a dependency on the API key management logic to store status in metadata.
      // If metadata is not reliably populated, a fallback to IMGBED_KV.get(key.name) would be needed,
      // but that would revert to the less performant approach.
    }
    
    return new Response(JSON.stringify({
      totalImageCount,
      activeApiKeyCount,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('Error fetching dashboard stats:', e.message, e.stack);
    return new Response(JSON.stringify({ 
      error: 'Failed to retrieve dashboard statistics.', 
      details: e.message 
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
