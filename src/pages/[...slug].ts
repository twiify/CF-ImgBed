import type { APIRoute } from 'astro';

// Helper object to map AppSettings keys to their KV store keys
// This should ideally be shared or kept in sync with settings API if not already.
const CONFIG_KEYS = {
    defaultCopyFormat: 'config:defaultCopyFormat',
    customImagePrefix: 'config:customImagePrefix',
    enableHotlinkProtection: 'config:enableHotlinkProtection',
    allowedDomains: 'config:allowedDomains',
    siteDomain: 'config:siteDomain',
};

export const prerender = false; // Ensure this dynamic route is server-rendered

export const GET: APIRoute = async ({
    params,
    locals,
    request,
}): Promise<Response> => {
    const slug = params.slug; // This will be 'prefix/imageId.ext' or 'imageId.ext'
    if (!slug) {
        return new Response('Not found', { status: 404 });
    }

    // Early exit for common non-image paths like .well-known or other dotfiles/dirs
    if (
        slug.startsWith('.') ||
        slug.startsWith('favicon.ico') ||
        slug.startsWith('robots.txt')
    ) {
        return new Response('Not found', { status: 404 });
    }

    const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;

    if (!IMGBED_KV || !IMGBED_R2) {
        console.error('KV or R2 not configured for image serving.');
        return new Response('Server configuration error', { status: 500 });
    }

    // 1. Determine the image ID and validate path prefix
    const configuredImagePrefix = (
        (await IMGBED_KV.get('config:customImagePrefix')) || 'img'
    )
        .trim()
        .replace(/^\/+|\/+$/g, '');

    let imageIdWithExt: string;
    const slugParts = slug.split('/');

    if (configuredImagePrefix === '') {
        // No prefix configured; URL should not contain a prefix.
        if (slugParts.length > 1) {
            // URL like "someprefix/image.jpg" but no prefix is configured.
            console.warn(
                `Access denied: URL contains prefix segments, but no image prefix is configured. Slug: ${slug}`,
            );
            return new Response('Not found (unexpected path segments)', {
                status: 404,
            });
        }
        imageIdWithExt = slugParts[0]; // e.g., "image.jpg"
    } else {
        // A prefix is configured. URL must match this prefix structure.
        if (slugParts.length < 2) {
            // URL like "image.jpg", but prefix "img" is configured. Missing prefix.
            console.warn(
                `Access denied: URL is missing the required prefix '${configuredImagePrefix}'. Slug: ${slug}`,
            );
            return new Response('Not found (missing required prefix)', {
                status: 404,
            });
        }
        const urlPrefix = slugParts.slice(0, -1).join('/');
        if (urlPrefix !== configuredImagePrefix) {
            // URL like "otherprefix/image.jpg", but prefix "img" is configured. Mismatched prefix.
            console.warn(
                `Access denied: URL prefix '${urlPrefix}' does not match configured prefix '${configuredImagePrefix}'. Slug: ${slug}`,
            );
            return new Response('Not found (invalid prefix)', { status: 404 });
        }
        imageIdWithExt = slugParts[slugParts.length - 1]; // e.g., "image.jpg" from "img/image.jpg"
    }

    // Extract imageId (without extension)
    const imageId = imageIdWithExt.includes('.')
        ? imageIdWithExt.substring(0, imageIdWithExt.lastIndexOf('.'))
        : imageIdWithExt;

    // 2. Fetch ImageMetadata from KV
    const metadataString = await IMGBED_KV.get(`image:${imageId}`);
    if (!metadataString) {
        console.warn(
            `Image metadata not found for imageId: ${imageId} (derived from slug: ${slug})`,
        );
        return new Response('Image metadata not found', { status: 404 });
    }

    interface ImageFileMetadata {
        // Define a clear type for the expected metadata structure
        r2Key: string;
        contentType: string;
        fileName: string;
        // Include other fields from the full ImageMetadata if needed by this endpoint
    }
    let metadata: ImageFileMetadata;
    try {
        metadata = JSON.parse(metadataString) as ImageFileMetadata;
        if (!metadata.r2Key || !metadata.contentType || !metadata.fileName) {
            throw new Error(
                'Essential metadata fields (r2Key, contentType, fileName) are missing.',
            );
        }
    } catch (e: any) {
        console.error(
            `Slug Route: Error parsing metadata for imageId ${imageId}:`,
            e.message,
            e.stack,
        );
        return new Response('Error retrieving image details', { status: 500 });
    }

    // 3. (Optional) Hotlink protection
    const enableHotlinkProtection =
        (await IMGBED_KV.get(CONFIG_KEYS.enableHotlinkProtection)) === 'true';
    if (enableHotlinkProtection) {
        const referer = request.headers.get('Referer');
        const allowedDomainsJsonString = await IMGBED_KV.get(
            CONFIG_KEYS.allowedDomains,
        );
        let allowedDomains: string[] = [];
        if (allowedDomainsJsonString) {
            try {
                allowedDomains = JSON.parse(
                    allowedDomainsJsonString,
                ) as string[]; // Expecting JSON array as stored by settings API
                if (!Array.isArray(allowedDomains))
                    throw new Error('allowedDomains is not an array');
            } catch (e: any) {
                console.error(
                    'Slug Route: Error parsing allowedDomains for hotlink protection from KV. Value:',
                    allowedDomainsJsonString,
                    'Error:',
                    e.message,
                );
                allowedDomains = []; // Default to empty if parsing fails
            }
        }

        // Always allow access if no referer (direct access) or if referer is from the configured siteDomain or current request's host
        const siteDomainFromConfig = await IMGBED_KV.get(
            CONFIG_KEYS.siteDomain,
        );
        const ownReferrers: string[] = [];

        // 安全地获取当前请求的主机名
        try {
            ownReferrers.push(new URL(request.url).host);
        } catch (e) {
            console.warn(
                'Slug Route: Invalid request URL format:',
                request.url,
            );
        }

        if (siteDomainFromConfig) {
            try {
                ownReferrers.push(
                    new URL(
                        siteDomainFromConfig.startsWith('http')
                            ? siteDomainFromConfig
                            : `https://${siteDomainFromConfig}`,
                    ).host,
                );
            } catch (e) {
                console.warn(
                    'Slug Route: Invalid siteDomainFromConfig format:',
                    siteDomainFromConfig,
                );
            }
        }

        let isAllowed = !referer; // Allow if no referer (direct access)
        if (referer) {
            try {
                const refererHost = new URL(referer).host;
                if (
                    ownReferrers.includes(refererHost) ||
                    allowedDomains.some(
                        (domain) =>
                            refererHost === domain ||
                            refererHost.endsWith('.' + domain),
                    )
                ) {
                    isAllowed = true;
                }
            } catch (e) {
                console.warn(
                    'Slug Route: Invalid referer URL format:',
                    referer,
                );
                isAllowed = false; // 拒绝无效的引用者
            }
        }

        if (!isAllowed) {
            console.warn(
                `Slug Route: Hotlink attempt blocked for ${metadata.r2Key} from referer: ${referer}`,
            );
            return new Response('Hotlinking not allowed', { status: 403 });
        }
    }

    // 4. Check Cache API
    let cachedResponse = null;
    let cacheKeyString: string | null = null; // Initialize cacheKeyString

    // Construct cache key using metadata.r2Key for uniqueness and valid URL format.
    // This needs to be done after metadata is fetched and parsed.
    if (metadata && metadata.r2Key) {
        const requestUrlForCache = new URL(request.url);
        // Ensure r2Key is URI encoded as it might contain characters like '/'
        // which are valid in r2Key but need encoding for a single URL path segment.
        const safeR2KeyForPath = encodeURIComponent(metadata.r2Key);
        const cacheUrl = new URL(
            `/r2-cache/${safeR2KeyForPath}`,
            requestUrlForCache.origin,
        );
        cacheKeyString = cacheUrl.toString();
    }

    // 检查 caches API 是否可用 and if a valid cacheKeyString was generated
    if (
        cacheKeyString &&
        locals.runtime.caches &&
        locals.runtime.caches.default
    ) {
        const cache = locals.runtime.caches.default;
        try {
            cachedResponse = await cache.match(cacheKeyString);
        } catch (e) {
            console.error(
                'Cache API match error:',
                e,
                'with key:',
                cacheKeyString,
            );
            // Decide if to proceed without cache or return an error
        }
    }

    if (cachedResponse) {
        // 如果在缓存中找到，克隆它以修改头部，然后返回。
        // 确保强制类型转换为标准的 Response 类型，经过 unknown 中间类型
        const newResponse = cachedResponse.clone() as unknown as Response;
        newResponse.headers.set('X-Cache-Status', 'HIT');
        return newResponse;
    }

    // 如果缓存中没有，则继续从 R2 获取
    // 4. Fetch image from R2
    const r2Object = await IMGBED_R2.get(metadata.r2Key);
    if (r2Object === null) {
        console.error(
            `Slug Route: R2 object not found for key ${metadata.r2Key} (imageId: ${imageId}). KV might be out of sync.`,
        );
        return new Response('Image file not found in storage', { status: 404 });
    }

    // 5. Stream response with appropriate headers
    const responseHeaders = new Headers();

    // Set Content-Type from R2 metadata, fallback to KV metadata if necessary
    responseHeaders.set(
        'Content-Type',
        r2Object.httpMetadata?.contentType || metadata.contentType,
    );

    // Set other relevant headers from R2 object's metadata
    if (r2Object.httpMetadata?.contentLanguage)
        responseHeaders.set(
            'Content-Language',
            r2Object.httpMetadata.contentLanguage,
        );

    // Always construct Content-Disposition from metadata.fileName to ensure proper encoding
    const encodedFileName = encodeURIComponent(metadata.fileName);
    responseHeaders.set(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodedFileName}`,
    );

    if (r2Object.httpMetadata?.contentEncoding)
        responseHeaders.set(
            'Content-Encoding',
            r2Object.httpMetadata.contentEncoding,
        );

    // Cache-Control: Prefer R2's, then add a default.
    if (r2Object.httpMetadata?.cacheControl) {
        responseHeaders.set(
            'Cache-Control',
            r2Object.httpMetadata.cacheControl,
        );
    } else {
        responseHeaders.set(
            'Cache-Control',
            'public, max-age=604800, immutable',
        ); // Default: 7 days, immutable
    }

    if (r2Object.httpMetadata?.cacheExpiry) {
        if (r2Object.httpMetadata.cacheExpiry instanceof Date) {
            responseHeaders.set(
                'Expires',
                r2Object.httpMetadata.cacheExpiry.toUTCString(),
            );
        } else if (typeof r2Object.httpMetadata.cacheExpiry === 'string') {
            try {
                responseHeaders.set(
                    'Expires',
                    new Date(r2Object.httpMetadata.cacheExpiry).toUTCString(),
                );
            } catch (e) {
                console.error(
                    'Slug Route: Error parsing cacheExpiry string from R2:',
                    e,
                );
            }
        }
    }

    responseHeaders.set('ETag', r2Object.httpEtag); // Crucial for client-side caching
    responseHeaders.set('Content-Length', String(r2Object.size)); // Set Content-Length from R2Object.size
    responseHeaders.set('X-Cache-Status', 'MISS'); // 指示缓存未命中

    // 使用类型断言确保响应类型是标准的 Web API Response，经过 unknown 中间类型
    const r2DerivedResponse = new Response(r2Object.body, {
        headers: responseHeaders,
        status: 200,
    }) as unknown as Response;

    // 将响应存入缓存以备将来请求使用。
    // 使用 response.clone() 是因为 Response 的 body 只能被消费一次。
    // 只缓存成功的响应 (status 200-299)。
    if (
        r2DerivedResponse.ok &&
        locals.runtime.caches &&
        locals.runtime.caches.default
    ) {
        const cache = locals.runtime.caches.default;
        // 使用类型断言来满足 Cloudflare Workers 的 Response 类型要求，经过 unknown 中间类型
        // Ensure the key used for cache.put is also a valid URL or Request object.
        if (cacheKeyString) {
            // Only attempt to put if cacheKeyString is valid
            locals.runtime.ctx.waitUntil(
                cache.put(
                    cacheKeyString,
                    r2DerivedResponse.clone() as unknown as any,
                ),
            );
        }
    }

    return r2DerivedResponse;
};
