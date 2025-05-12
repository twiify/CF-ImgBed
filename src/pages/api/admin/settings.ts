import type { APIRoute } from 'astro';

interface AppSettings {
  defaultCopyFormat?: string;
  customImagePrefix?: string;
  enableHotlinkProtection?: boolean;
  allowedDomains?: string[]; // Stored as JSON string array in KV
  siteDomain?: string; // New setting for custom domain
}

const CONFIG_KEYS: Record<keyof AppSettings, string> = {
  defaultCopyFormat: 'config:defaultCopyFormat',
  customImagePrefix: 'config:customImagePrefix',
  enableHotlinkProtection: 'config:enableHotlinkProtection',
  allowedDomains: 'config:allowedDomains',
  siteDomain: 'config:siteDomain', // New config key
};

// GET: Retrieve current settings
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
    const settings: AppSettings = {};
    
    const defaultCopyFormat = await IMGBED_KV.get(CONFIG_KEYS.defaultCopyFormat);
    if (defaultCopyFormat) settings.defaultCopyFormat = defaultCopyFormat;

    const customImagePrefix = await IMGBED_KV.get(CONFIG_KEYS.customImagePrefix);
    if (customImagePrefix) settings.customImagePrefix = customImagePrefix;
    
    const enableHotlinkProtectionStr = await IMGBED_KV.get(CONFIG_KEYS.enableHotlinkProtection);
    if (enableHotlinkProtectionStr) settings.enableHotlinkProtection = enableHotlinkProtectionStr === 'true';

    const allowedDomainsStr = await IMGBED_KV.get(CONFIG_KEYS.allowedDomains);
    if (allowedDomainsStr) {
      try {
        settings.allowedDomains = JSON.parse(allowedDomainsStr);
      } catch (e) {
        console.error('Failed to parse allowedDomains from KV:', e);
        // settings.allowedDomains will remain undefined or be an empty array if initialized
      }
    }

    const siteDomain = await IMGBED_KV.get(CONFIG_KEYS.siteDomain);
    if (siteDomain) settings.siteDomain = siteDomain;

    return new Response(JSON.stringify(settings), { status: 200 });
  } catch (e: any) {
    console.error('Error fetching settings:', e);
    return new Response(JSON.stringify({ error: 'Failed to retrieve settings', details: e.message }), { status: 500 });
  }
};

// POST: Update settings
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user; // locals.user is defined via middleware and App.Locals
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  let newSettings: AppSettings;
  try {
    newSettings = await request.json();
    if (typeof newSettings !== 'object' || newSettings === null) {
        throw new Error('Invalid settings payload type');
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 });
  }

  try {
    const promises = [];

    if (typeof newSettings.defaultCopyFormat === 'string') {
      promises.push(IMGBED_KV.put(CONFIG_KEYS.defaultCopyFormat, newSettings.defaultCopyFormat));
    }
    // Allow empty string for prefix to signify no prefix
    if (typeof newSettings.customImagePrefix === 'string') {
      promises.push(IMGBED_KV.put(CONFIG_KEYS.customImagePrefix, newSettings.customImagePrefix.trim()));
    }
    if (typeof newSettings.enableHotlinkProtection === 'boolean') {
      promises.push(IMGBED_KV.put(CONFIG_KEYS.enableHotlinkProtection, String(newSettings.enableHotlinkProtection)));
    }
    if (Array.isArray(newSettings.allowedDomains)) {
      const validDomains = newSettings.allowedDomains.map(d => String(d).trim()).filter(d => d);
      promises.push(IMGBED_KV.put(CONFIG_KEYS.allowedDomains, JSON.stringify(validDomains)));
    }
    // Allow empty string for siteDomain to signify reverting to auto-detection
    if (typeof newSettings.siteDomain === 'string') {
        promises.push(IMGBED_KV.put(CONFIG_KEYS.siteDomain, newSettings.siteDomain.trim()));
    }


    await Promise.all(promises);

    return new Response(JSON.stringify({ message: 'Settings updated successfully' }), { status: 200 });
  } catch (e: any) {
    console.error('Error updating settings:', e);
    return new Response(JSON.stringify({ error: 'Failed to update settings', details: e.message }), { status: 500 });
  }
};
