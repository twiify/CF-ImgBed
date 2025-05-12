import type { APIRoute } from 'astro';

interface ApiKeyRecord { 
  status: 'active' | 'revoked';
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  try {
    // Get total image count
    const imageListResult = await IMGBED_KV.list({ prefix: 'image:' });
    const totalImageCount = imageListResult.keys.length;

    // Get active API Key count
    const apiKeyListResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
    let activeApiKeyCount = 0;
    for (const key of apiKeyListResult.keys) {
      const recordString = await IMGBED_KV.get(key.name);
      if (recordString) {
        try {
          const record = JSON.parse(recordString) as ApiKeyRecord;
          if (record.status === 'active') {
            activeApiKeyCount++;
          }
        } catch (e) {
          console.error(`Failed to parse API key record ${key.name} for stats:`, e);
        }
      }
    }
    
    return new Response(JSON.stringify({
      totalImageCount,
      activeApiKeyCount,
    }), { status: 200 });

  } catch (e: any) {
    console.error('Error fetching dashboard stats:', e);
    return new Response(JSON.stringify({ error: 'Failed to retrieve dashboard statistics', details: e.message }), { status: 500 });
  }
};
