import type { APIRoute } from 'astro';

export interface AppSettings {
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
  siteDomain: 'config:siteDomain',
};

// GET: Retrieve current settings
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('Settings GET: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
        settings.allowedDomains = JSON.parse(allowedDomainsStr) as string[];
      } catch (e) {
        console.error('Settings GET: Failed to parse allowedDomains from KV:', e);
        settings.allowedDomains = []; // Default to empty array on parse error for consistency
      }
    } else {
      settings.allowedDomains = []; // Default to empty array if not set
    }

    const siteDomain = await IMGBED_KV.get(CONFIG_KEYS.siteDomain);
    if (siteDomain) settings.siteDomain = siteDomain;
    // If siteDomain is not set, it remains undefined in the response, client should handle.

    return new Response(JSON.stringify(settings), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('Settings GET: Error fetching settings:', e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to retrieve settings', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// POST: Update settings
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('Settings POST: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let newSettings: AppSettings;
  try {
    newSettings = await request.json();
    if (typeof newSettings !== 'object' || newSettings === null) {
        throw new Error('Invalid settings payload type, expected an object.');
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Invalid request body: ' + e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const kvOperations: Promise<void>[] = [];

    // Validate and prepare each setting for storage
    if (Object.prototype.hasOwnProperty.call(newSettings, 'defaultCopyFormat') && typeof newSettings.defaultCopyFormat === 'string') {
      kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.defaultCopyFormat, newSettings.defaultCopyFormat));
    }
    
    if (Object.prototype.hasOwnProperty.call(newSettings, 'customImagePrefix') && typeof newSettings.customImagePrefix === 'string') {
      // Allow empty string for prefix to signify no prefix (root path for images)
      kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.customImagePrefix, newSettings.customImagePrefix.trim()));
    }

    if (Object.prototype.hasOwnProperty.call(newSettings, 'enableHotlinkProtection') && typeof newSettings.enableHotlinkProtection === 'boolean') {
      kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.enableHotlinkProtection, String(newSettings.enableHotlinkProtection)));
    }

    if (Object.prototype.hasOwnProperty.call(newSettings, 'allowedDomains') && Array.isArray(newSettings.allowedDomains)) {
      // Ensure all elements are strings, trim, and filter out empty ones
      const validDomains = newSettings.allowedDomains
        .map(d => String(d).trim())
        .filter(d => d.length > 0);
      kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.allowedDomains, JSON.stringify(validDomains)));
    }
    
    if (Object.prototype.hasOwnProperty.call(newSettings, 'siteDomain') && typeof newSettings.siteDomain === 'string') {
      // Allow empty string for siteDomain to signify reverting to auto-detection by the application
      kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.siteDomain, newSettings.siteDomain.trim()));
    }

    await Promise.all(kvOperations);

    return new Response(JSON.stringify({ message: 'Settings updated successfully' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('Settings POST: Error updating settings:', e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to update settings', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
