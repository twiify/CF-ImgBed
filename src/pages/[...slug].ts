import type { APIRoute } from 'astro';

export const prerender = false; // Ensure this dynamic route is server-rendered

export const GET: APIRoute = async ({ params, locals, request }) => {
  const slug = params.slug; // This will be 'prefix/imageId.ext' or 'imageId.ext'
  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  // Early exit for common non-image paths like .well-known or other dotfiles/dirs
  if (slug.startsWith('.') || slug.startsWith('favicon.ico') || slug.startsWith('robots.txt')) {
    return new Response('Not found', { status: 404 });
  }

  const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;

  if (!IMGBED_KV || !IMGBED_R2) {
    console.error('KV or R2 not configured for image serving.');
    return new Response('Server configuration error', { status: 500 });
  }

  // 1. Get configured custom prefix from KV
  const configuredPrefix = (await IMGBED_KV.get('config:customImagePrefix')) || 'img';
  
  let imageIdWithExt: string;
  const parts = slug.split('/');
  
  if (parts.length > 1) {
    const requestPrefix = parts.slice(0, -1).join('/');
    if (requestPrefix !== configuredPrefix.replace(/^\/+|\/+$/g, '')) {
      // If a prefix is present in URL but doesn't match, it's a 404 or a direct R2 key access attempt (which we might disallow)
      console.warn(`Image access attempt with mismatched prefix. Expected: '${configuredPrefix}', Got: '${requestPrefix}' for slug: '${slug}'`);
      // Depending on strictness, could return 404 here.
      // For now, let's assume if a prefix is used, it MUST match.
      // If no prefix is in config (configuredPrefix is empty string), then parts.length should be 1.
      if (configuredPrefix && configuredPrefix.trim() !== '') {
         return new Response('Not found (invalid prefix)', { status: 404 });
      } else if (parts.length > 1 && (!configuredPrefix || configuredPrefix.trim() === '')) {
         // URL has a prefix, but no prefix is configured.
         return new Response('Not found (unexpected prefix)', { status: 404 });
      }
    }
    imageIdWithExt = parts[parts.length - 1];
  } else if (parts.length === 1 && (!configuredPrefix || configuredPrefix.trim() === '')) {
    // No prefix in URL, and no prefix configured. This is fine.
    imageIdWithExt = parts[0];
  } else if (parts.length === 1 && configuredPrefix && configuredPrefix.trim() !== '') {
    // No prefix in URL, but a prefix IS configured. This means the URL is missing the required prefix.
    return new Response('Not found (missing required prefix)', { status: 404 });
  } else {
    // Should not happen with slug.split('/')
    return new Response('Invalid path', { status: 400 });
  }


  const imageId = imageIdWithExt.includes('.') ? imageIdWithExt.substring(0, imageIdWithExt.lastIndexOf('.')) : imageIdWithExt;

  // 2. Fetch ImageMetadata from KV
  const metadataString = await IMGBED_KV.get(`image:${imageId}`);
  if (!metadataString) {
    return new Response('Image metadata not found', { status: 404 });
  }
  
  let metadata;
  try {
    metadata = JSON.parse(metadataString) as { r2Key: string; contentType: string; fileName: string; /* other fields from ImageMetadata */ };
  } catch (e) {
    console.error(`Error parsing metadata for imageId ${imageId}:`, e);
    return new Response('Error retrieving image details', { status: 500 });
  }

  // 3. (Optional) Hotlink protection
  const enableHotlinkProtection = (await IMGBED_KV.get('config:enableHotlinkProtection')) === 'true'; // Assuming stored as string 'true'/'false'
  if (enableHotlinkProtection) {
    const referer = request.headers.get('Referer');
    const allowedDomainsString = await IMGBED_KV.get('config:allowedDomains'); // CSV string or JSON array string
    let allowedDomains: string[] = [];
    if (allowedDomainsString) {
      try {
        // Assuming stored as a simple comma-separated string for simplicity, or adapt if JSON array
        allowedDomains = allowedDomainsString.split(',').map(d => d.trim()).filter(d => d);
      } catch (e) { console.error("Error parsing allowedDomains for hotlink protection", e); }
    }
    
    // Always allow access if no referer (direct access) or if referer is from own site
    const ownHost = new URL(request.url).host;
    let isAllowed = !referer || new URL(referer).host === ownHost;

    if (!isAllowed && referer) {
      const refererHost = new URL(referer).host;
      if (allowedDomains.some(domain => refererHost === domain || refererHost.endsWith('.' + domain))) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      console.warn(`Hotlink attempt blocked for ${metadata.r2Key} from referer: ${referer}`);
      return new Response('Hotlinking not allowed', { status: 403 });
    }
  }


  // 4. Fetch image from R2
  const object = await IMGBED_R2.get(metadata.r2Key);
  if (object === null) {
    // This case might mean KV is out of sync with R2, or r2Key in KV is wrong
    console.error(`R2 object not found for key ${metadata.r2Key} (imageId: ${imageId})`);
    return new Response('Image file not found in storage', { status: 404 });
  }

  // 5. Stream response
  const headers = new Headers();
  
  // Manually set headers from R2Object's httpMetadata to avoid non-POJO issues with devalue
  if (object.httpMetadata?.contentType) {
    headers.set('Content-Type', object.httpMetadata.contentType);
  }
  if (object.httpMetadata?.contentLanguage) {
    headers.set('Content-Language', object.httpMetadata.contentLanguage);
  }
  if (object.httpMetadata?.contentDisposition) {
    headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
  }
  if (object.httpMetadata?.contentEncoding) {
    headers.set('Content-Encoding', object.httpMetadata.contentEncoding);
  }
  if (object.httpMetadata?.cacheControl) {
    headers.set('Cache-Control', object.httpMetadata.cacheControl);
  }
  if (object.httpMetadata?.cacheExpiry) {
    // Ensure cacheExpiry is a Date object and convert to HTTP-date string
    if (object.httpMetadata.cacheExpiry instanceof Date) {
      headers.set('Expires', object.httpMetadata.cacheExpiry.toUTCString());
    } else if (typeof object.httpMetadata.cacheExpiry === 'string') {
       // If it's already a string, assume it's correctly formatted (or parse and reformat)
       try {
        headers.set('Expires', new Date(object.httpMetadata.cacheExpiry).toUTCString());
       } catch (e) { console.error("Error parsing cacheExpiry string:", e); }
    }
  }

  headers.set('ETag', object.httpEtag); // Important for caching
  // Consider adding a default Cache-Control if not set by R2 object, e.g.:
  // if (!headers.has('Cache-Control')) {
  //   headers.set('Cache-Control', 'public, max-age=3600'); // Example: 1 hour
  // }

  // For downloads or to suggest original filename (using metadata from KV for consistency):
  // headers.set('Content-Disposition', `inline; filename="${metadata.fileName}"`);

  return new Response(object.body, {
    headers,
  });
};
