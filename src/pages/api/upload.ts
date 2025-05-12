import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { simpleHash } from '~/lib/utils'; // Import shared simpleHash function

// Define a type for the image metadata we'll store in KV (and potentially return)
interface ImageMetadata {
  id: string; // Short ID for the image, used in friendly URLs
  r2Key: string; // Full key in R2, including path
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string; // ISO string
  userId?: string; // Optional: if uploaded by a logged-in user
  uploadPath?: string; // User-specified sub-directory
}

export const POST: APIRoute = async ({ request, locals }) => {
  // 1. Authentication & Authorization
  const user = locals.user; // User object from middleware (session authentication)
  const apiKey = request.headers.get('X-API-Key'); // API key from header

  // Require either a valid session or a valid API key for uploading
  if (!user && !(await isValidApiKey(apiKey, locals.runtime.env.IMGBED_KV))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // 2. Parse FormData
  let formData;
  try {
    formData = await request.formData();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid FormData' }), { status: 400 });
  }

  const files = formData.getAll('files') as File[];
  const uploadDirectory = formData.get('uploadDirectory') as string | undefined;

  if (!files || files.length === 0) {
    return new Response(JSON.stringify({ error: 'No files uploaded' }), { status: 400 });
  }

  const { IMGBED_R2, IMGBED_KV } = locals.runtime.env;

  if (!IMGBED_R2 || !IMGBED_KV) {
    console.error('Server configuration error: R2 bucket or KV namespace not bound.');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  const uploadedFileResults: Array<ImageMetadata & { url: string }> = [];

  for (const file of files) {
    if (!(file instanceof File)) {
      console.warn('Skipping non-file entry in FormData');
      continue;
    }
    try {
      const fileBuffer = await file.arrayBuffer();
      const imageId = nanoid(10); 
      const fileExtension = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
      
      let r2ObjectKey = `${imageId}${fileExtension}`;
      if (uploadDirectory && uploadDirectory.trim() !== '') {
        const saneUploadDir = uploadDirectory.trim().replace(/^\/+|\/+$/g, '');
        if (saneUploadDir) {
            r2ObjectKey = `${saneUploadDir}/${imageId}${fileExtension}`;
        }
      }

      await IMGBED_R2.put(r2ObjectKey, fileBuffer, {
        httpMetadata: { contentType: file.type },
      });

      const metadata: ImageMetadata = {
        id: imageId,
        r2Key: r2ObjectKey,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        userId: user?.userId, // Assign userId if session authenticated
        uploadPath: uploadDirectory?.trim() || undefined,
      };

      // If authenticated via API key and user ID is not yet set (i.e., not from session),
      // attempt to get userId from the validated API key.
      // This avoids calling isValidApiKey twice if user is already authenticated via session.
      if (!metadata.userId && apiKey) {
        const apiKeyDetails = await isValidApiKey(apiKey, IMGBED_KV);
        if (apiKeyDetails) {
            metadata.userId = apiKeyDetails.userId;
        }
      }

      await IMGBED_KV.put(`image:${imageId}`, JSON.stringify(metadata));

      // Construct the public URL for the image
      let baseUrl = '';
      const configuredDomain = await IMGBED_KV.get('config:siteDomain'); // User-configured custom domain
      if (configuredDomain && configuredDomain.trim() !== '') {
        baseUrl = configuredDomain.trim().replace(/\/$/, ''); // Remove trailing slash
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
          baseUrl = 'https://' + baseUrl; // Default to https if no protocol
        }
      } else {
        // Fallback to the request's origin if no custom domain is set
        const requestUrl = new URL(request.url);
        baseUrl = requestUrl.origin;
      }
      
      const imageAccessPrefix = (await IMGBED_KV.get('config:customImagePrefix')) || 'img'; // Customizable image path prefix
      const prefixPath = imageAccessPrefix.trim().replace(/^\/+|\/+$/g, ''); // Sanitize prefix
      
      const publicUrl = `${baseUrl}/${prefixPath ? prefixPath + '/' : ''}${imageId}${fileExtension}`;
      
      uploadedFileResults.push({ ...metadata, url: publicUrl });

    } catch (e: any) {
      console.error(`Failed to upload ${file.name}:`, e.message, e.stack);
      // Note: Current implementation stops at the first error.
      // For robust multi-file uploads, consider collecting errors and reporting them all at the end.
      return new Response(JSON.stringify({ error: `Failed to upload ${file.name}. ${e.message}` }), { status: 500 });
    }
  }

  if (uploadedFileResults.length === 0) {
    return new Response(JSON.stringify({ error: 'No files were successfully processed.' }), { status: 400 });
  }

  return new Response(JSON.stringify({
    message: 'Files uploaded successfully!',
    files: uploadedFileResults,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// ApiKeyRecord interface used by isValidApiKey
interface ApiKeyRecord { 
  id: string;
  name: string;
  userId: string;
  keyPrefix: string;
  hashedKey: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  permissions: string[];
  status: 'active' | 'revoked';
}

async function isValidApiKey(apiKeyFromHeader: string | null, kv: KVNamespace): Promise<false | Pick<ApiKeyRecord, 'userId' | 'id'>> {
  if (!apiKeyFromHeader) {
    return false;
  }
  const parts = apiKeyFromHeader.split('_');
  if (parts.length !== 4 || parts[0] !== 'imgbed' || parts[1] !== 'sk') {
    console.warn('Invalid API key format received.');
    return false; 
  }
  const publicIdPart = parts[2];
  const recordId = await kv.get(`apikey_public_id:${publicIdPart}`);
  if (!recordId) {
    console.warn(`No API key record found for publicId: ${publicIdPart}`);
    return false;
  }
  const recordString = await kv.get(`apikey_record:${recordId}`);
  if (!recordString) {
    console.warn(`API key record not found for recordId: ${recordId} (inconsistent state)`);
    return false;
  }
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
      if(record.status !== 'active') console.warn(`API key ${recordId} is not active (status: ${record.status}).`);
      if(record.hashedKey !== hashedApiKeyFromHeader) console.warn(`API key ${recordId} hash mismatch.`);
    }
  } catch (e) {
    console.error(`Error parsing API key record ${recordId}:`, e);
  }
  return false;
}
