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

  // 1. Determine the image ID and validate path prefix
  const configuredImagePrefix = (await IMGBED_KV.get('config:customImagePrefix') || 'img').trim().replace(/^\/+|\/+$/g, '');
  
  let imageIdWithExt: string;
  const slugParts = slug.split('/');

  if (configuredImagePrefix === '') {
    // No prefix configured; URL should not contain a prefix.
    if (slugParts.length > 1) {
      // URL like "someprefix/image.jpg" but no prefix is configured.
      console.warn(`Access denied: URL contains prefix segments, but no image prefix is configured. Slug: ${slug}`);
      return new Response('Not found (unexpected path segments)', { status: 404 });
    }
    imageIdWithExt = slugParts[0]; // e.g., "image.jpg"
  } else {
    // A prefix is configured. URL must match this prefix structure.
    if (slugParts.length < 2) {
      // URL like "image.jpg", but prefix "img" is configured. Missing prefix.
      console.warn(`Access denied: URL is missing the required prefix '${configuredImagePrefix}'. Slug: ${slug}`);
      return new Response('Not found (missing required prefix)', { status: 404 });
    }
    const urlPrefix = slugParts.slice(0, -1).join('/');
    if (urlPrefix !== configuredImagePrefix) {
      // URL like "otherprefix/image.jpg", but prefix "img" is configured. Mismatched prefix.
      console.warn(`Access denied: URL prefix '${urlPrefix}' does not match configured prefix '${configuredImagePrefix}'. Slug: ${slug}`);
      return new Response('Not found (invalid prefix)', { status: 404 });
    }
    imageIdWithExt = slugParts[slugParts.length - 1]; // e.g., "image.jpg" from "img/image.jpg"
  }

  // Extract imageId (without extension)
  const imageId = imageIdWithExt.includes('.') ? imageIdWithExt.substring(0, imageIdWithExt.lastIndexOf('.')) : imageIdWithExt;

  // 2. Fetch ImageMetadata from KV
  const metadataString = await IMGBED_KV.get(`image:${imageId}`);
  if (!metadataString) {
    console.warn(`Image metadata not found for imageId: ${imageId} (derived from slug: ${slug})`);
    return new Response('Image metadata not found', { status: 404 });
  }
  
  interface ImageFileMetadata { // Define a clear type for the expected metadata structure
      r2Key: string;
      contentType: string;
      fileName: string;
      // Include other fields from the full ImageMetadata if needed by this endpoint
  }
  let metadata: ImageFileMetadata;
  try {
    metadata = JSON.parse(metadataString) as ImageFileMetadata;
    if (!metadata.r2Key || !metadata.contentType || !metadata.fileName) {
        throw new Error('Essential metadata fields (r2Key, contentType, fileName) are missing.');
    }
  } catch (e: any) {
    console.error(`Slug Route: Error parsing metadata for imageId ${imageId}:`, e.message, e.stack);
    return new Response('Error retrieving image details', { status: 500 });
  }

  // 3. (Optional) Hotlink protection
  const enableHotlinkProtection = (await IMGBED_KV.get(CONFIG_KEYS.enableHotlinkProtection)) === 'true';
  if (enableHotlinkProtection) {
    const referer = request.headers.get('Referer');
    const allowedDomainsJsonString = await IMGBED_KV.get(CONFIG_KEYS.allowedDomains);
    let allowedDomains: string[] = [];
    if (allowedDomainsJsonString) {
      try {
        allowedDomains = JSON.parse(allowedDomainsJsonString) as string[]; // Expecting JSON array as stored by settings API
        if (!Array.isArray(allowedDomains)) throw new Error('allowedDomains is not an array');
      } catch (e: any) { 
        console.error("Slug Route: Error parsing allowedDomains for hotlink protection from KV. Value:", allowedDomainsJsonString, "Error:", e.message);
        allowedDomains = []; // Default to empty if parsing fails
      }
    }
    
    // Always allow access if no referer (direct access) or if referer is from the configured siteDomain or current request's host
    const siteDomainFromConfig = await IMGBED_KV.get(CONFIG_KEYS.siteDomain);
    const ownReferrers: string[] = [new URL(request.url).host];
    if (siteDomainFromConfig) {
        try {
            ownReferrers.push(new URL(siteDomainFromConfig.startsWith('http') ? siteDomainFromConfig : `https://${siteDomainFromConfig}`).host);
        } catch (e) { console.warn("Slug Route: Invalid siteDomainFromConfig format:", siteDomainFromConfig); }
    }
    
    let isAllowed = !referer; // Allow if no referer (direct access)
    if (referer) {
        const refererHost = new URL(referer).host;
        if (ownReferrers.includes(refererHost) || allowedDomains.some(domain => refererHost === domain || refererHost.endsWith('.' + domain))) {
            isAllowed = true;
        }
    }

    if (!isAllowed) {
      console.warn(`Slug Route: Hotlink attempt blocked for ${metadata.r2Key} from referer: ${referer}`);
      return new Response('Hotlinking not allowed', { status: 403 });
    }
  }

  // 4. Fetch image from R2
  const r2Object = await IMGBED_R2.get(metadata.r2Key);
  if (r2Object === null) {
    console.error(`Slug Route: R2 object not found for key ${metadata.r2Key} (imageId: ${imageId}). KV might be out of sync.`);
    return new Response('Image file not found in storage', { status: 404 });
  }

  // 5. Stream response with appropriate headers
  const responseHeaders = new Headers();
  
  // Set Content-Type from R2 metadata, fallback to KV metadata if necessary
  responseHeaders.set('Content-Type', r2Object.httpMetadata?.contentType || metadata.contentType);
  
  // Set other relevant headers from R2 object's metadata
  if (r2Object.httpMetadata?.contentLanguage) responseHeaders.set('Content-Language', r2Object.httpMetadata.contentLanguage);
  if (r2Object.httpMetadata?.contentDisposition) responseHeaders.set('Content-Disposition', r2Object.httpMetadata.contentDisposition);
  else responseHeaders.set('Content-Disposition', `inline; filename="${metadata.fileName}"`); // Default to inline with filename
  
  if (r2Object.httpMetadata?.contentEncoding) responseHeaders.set('Content-Encoding', r2Object.httpMetadata.contentEncoding);
  
  // Cache-Control: Prefer R2's, then add a default.
  if (r2Object.httpMetadata?.cacheControl) {
    responseHeaders.set('Cache-Control', r2Object.httpMetadata.cacheControl);
  } else {
    responseHeaders.set('Cache-Control', 'public, max-age=604800, immutable'); // Default: 7 days, immutable
  }
  
  if (r2Object.httpMetadata?.cacheExpiry) {
    if (r2Object.httpMetadata.cacheExpiry instanceof Date) {
      responseHeaders.set('Expires', r2Object.httpMetadata.cacheExpiry.toUTCString());
    } else if (typeof r2Object.httpMetadata.cacheExpiry === 'string') {
       try { responseHeaders.set('Expires', new Date(r2Object.httpMetadata.cacheExpiry).toUTCString()); }
       catch (e) { console.error("Slug Route: Error parsing cacheExpiry string from R2:", e); }
    }
  }
  
  responseHeaders.set('ETag', r2Object.httpEtag); // Crucial for client-side caching
  responseHeaders.set('Content-Length', String(r2Object.size)); // Set Content-Length from R2Object.size

  return new Response(r2Object.body, {
    headers: responseHeaders,
  });
};

// Helper object to map AppSettings keys to their KV store keys
// This should ideally be shared or kept in sync with settings API if not already.
const CONFIG_KEYS = {
  defaultCopyFormat: 'config:defaultCopyFormat',
  customImagePrefix: 'config:customImagePrefix',
  enableHotlinkProtection: 'config:enableHotlinkProtection',
  allowedDomains: 'config:allowedDomains',
  siteDomain: 'config:siteDomain',
};
