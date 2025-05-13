import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { nanoid } from 'nanoid';
import { simpleHash } from '~/lib/utils'; // Ensure this path is correct

// --- Helper Interfaces & Constants ---

// For App Settings
export interface AppSettings {
  defaultCopyFormat?: string;
  customImagePrefix?: string;
  enableHotlinkProtection?: boolean;
  allowedDomains?: string[]; // Stored as JSON string array in KV
  siteDomain?: string;
}

const CONFIG_KEYS: Record<keyof AppSettings, string> = {
  defaultCopyFormat: 'config:defaultCopyFormat',
  customImagePrefix: 'config:customImagePrefix',
  enableHotlinkProtection: 'config:enableHotlinkProtection',
  allowedDomains: 'config:allowedDomains',
  siteDomain: 'config:siteDomain',
};

// For Image Metadata
interface ImageMetadata {
  id: string;
  r2Key: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  userId?: string;
  uploadPath?: string;
}

// For API Key Records
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

// --- Helper Functions ---

async function isValidApiKeyInternal(apiKeyFromHeader: string | null, kv: KVNamespace): Promise<false | Pick<ApiKeyRecord, 'userId' | 'id'>> {
  if (!apiKeyFromHeader) {
    return false;
  }
  const parts = apiKeyFromHeader.split('_');
  if (parts.length !== 4 || parts[0] !== 'imgbed' || parts[1] !== 'sk') {
    console.warn('Invalid API key format received.');
    return false;
  }
  const publicIdPart = parts[2];
  const recordIdNullable = await kv.get(`apikey_public_id:${publicIdPart}`);
  if (!recordIdNullable) {
    console.warn(`No API key record found for publicId: ${publicIdPart}`);
    return false;
  }
  const recordId = recordIdNullable;

  const recordStringNullable = await kv.get(`apikey_record:${recordId}`);
  if (!recordStringNullable) {
    console.warn(`API key record not found for recordId: ${recordId} (inconsistent state)`);
    return false;
  }
  const recordString = recordStringNullable;

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
      if (record.status !== 'active') console.warn(`API key ${recordId} is not active (status: ${record.status}).`);
      if (record.hashedKey !== hashedApiKeyFromHeader) console.warn(`API key ${recordId} hash mismatch.`);
    }
  } catch (e) {
    console.error(`Error parsing API key record ${recordId}:`, e);
  }
  return false;
}

// --- Server Actions ---
export const server = {
  login: defineAction({
    accept: 'form',
    input: z.object({
      username: z.string().min(3, { message: "Username must be at least 3 characters long" }),
      password: z.string().min(6, { message: "Password must be at least 6 characters long" }),
    }),
    handler: async ({ username, password }, context) => {
      const { locals, cookies, request } = context;
      const { AUTH_USERNAME, AUTH_PASSWORD, IMGBED_KV } = locals.runtime.env;

      if (!IMGBED_KV) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server setup issue: KV namespace not available.' });
      }
      if (!AUTH_USERNAME || !AUTH_PASSWORD) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server setup issue: Authentication credentials not configured.' });
      }
      if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
        throw new ActionError({ code: 'UNAUTHORIZED', message: 'Invalid username or password.' });
      }

      const sessionId = nanoid(32);
      const sessionData = { userId: "admin_user_01", username };
      const sessionDurationSeconds = 7 * 24 * 60 * 60; // 7 days

      try {
        await IMGBED_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: sessionDurationSeconds });
        const isSecureContext = new URL(request.url).protocol === 'https:';
        const cookieName = isSecureContext ? '__Secure-sid' : 'sid';
        cookies.set(cookieName, sessionId, {
          path: '/', httpOnly: true, secure: isSecureContext, sameSite: 'lax', maxAge: sessionDurationSeconds,
        }); // Correctly close the cookies.set() call with a semicolon.

        // Action indicates success and where to redirect.
        // The page calling the action will handle the redirect.
        return { success: true, redirectTo: '/admin' };
      } catch (e: any) { // Restore the catch block content
        console.error("Error creating session or storing in KV:", e);
        throw new ActionError({
          code: 'INTERNAL_SERVER_ERROR',
          message: e.message || 'Failed to create session.',
        });
      }
    }
  }),

  logout: defineAction({
    accept: 'json',
    handler: async (_, { locals, cookies, request }) => {
      const { IMGBED_KV } = locals.runtime.env;
      const isSecureContext = new URL(request.url).protocol === 'https:';
      const cookieName = isSecureContext ? '__Secure-sid' : 'sid';
      const sessionId = cookies.get(cookieName)?.value;

      if (sessionId && IMGBED_KV) {
        try {
          await IMGBED_KV.delete(`session:${sessionId}`);
        } catch (e) {
          console.error(`Action: Error deleting session ${sessionId} from KV:`, e);
        }
      }
      
      // More aggressive cookie clearing
      cookies.set(cookieName, '', { // Set to empty value
        path: '/',
        httpOnly: true,
        secure: isSecureContext,
        sameSite: 'lax',
        expires: new Date(0) // Set to a past date (epoch)
      });
      // cookies.delete() should also work, but this is more explicit for some browsers/setups.
      // cookies.delete(cookieName, { path: '/', httpOnly: true, secure: isSecureContext, sameSite: 'lax' });
      
      return { success: true, redirectTo: '/login' };
    }
  }),

  upload: defineAction({
    accept: 'form',
    input: z.object({
      files: z.union([z.instanceof(File), z.array(z.instanceof(File))]).optional(),
      uploadDirectory: z.string().optional(),
    }),
    handler: async (input, context) => {
      const { locals, request } = context;
      const { IMGBED_R2, IMGBED_KV } = locals.runtime.env;
      const user = locals.user;
      const apiKeyHeader = request.headers.get('X-API-Key');
      let apiKeyDetails: false | Pick<ApiKeyRecord, 'userId' | 'id'> = false;

      if (!user) {
        apiKeyDetails = await isValidApiKeyInternal(apiKeyHeader, IMGBED_KV);
        if (!apiKeyDetails) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      if (!IMGBED_R2 || !IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error' });

      let filesToProcess: File[] = [];
      if (input.files) {
        filesToProcess = Array.isArray(input.files) ? input.files : [input.files];
      }
      if (filesToProcess.length === 0) throw new ActionError({ code: 'BAD_REQUEST', message: 'No files uploaded or files key is missing.' });

      const uploadDirectory = input.uploadDirectory;
      const uploadedFileResults: Array<ImageMetadata & { url: string }> = [];

      for (const file of filesToProcess) {
        if (!(file instanceof File) || file.size === 0) continue;
        try {
          const fileBuffer = await file.arrayBuffer();
          const imageId = nanoid(10);
          const fileExtension = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
          let r2ObjectKey = `${imageId}${fileExtension}`;
          if (uploadDirectory?.trim()) {
            const saneUploadDir = uploadDirectory.trim().replace(/^\/+|\/+$/g, '');
            if (saneUploadDir) r2ObjectKey = `${saneUploadDir}/${imageId}${fileExtension}`;
          }
          await IMGBED_R2.put(r2ObjectKey, fileBuffer, { httpMetadata: { contentType: file.type } });
          const metadata: ImageMetadata = {
            id: imageId, r2Key: r2ObjectKey, fileName: file.name, contentType: file.type, size: file.size, uploadedAt: new Date().toISOString(),
            userId: user?.userId || (apiKeyDetails ? apiKeyDetails.userId : undefined),
            uploadPath: uploadDirectory?.trim() || undefined,
          };
          await IMGBED_KV.put(`image:${imageId}`, JSON.stringify(metadata));
          let baseUrl = (await IMGBED_KV.get('config:siteDomain'))?.trim() || new URL(request.url).origin;
          if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) baseUrl = 'https://' + baseUrl;
          baseUrl = baseUrl.replace(/\/$/, '');
          const imageAccessPrefix = (await IMGBED_KV.get('config:customImagePrefix')) || 'img';
          const prefixPath = imageAccessPrefix.trim().replace(/^\/+|\/+$/g, '');
          const publicUrl = `${baseUrl}/${prefixPath ? prefixPath + '/' : ''}${imageId}${fileExtension}`;
          uploadedFileResults.push({ ...metadata, url: publicUrl });
        } catch (e: any) {
          throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to upload ${file.name}. ${e.message}` });
        }
      }
      if (uploadedFileResults.length === 0) throw new ActionError({ code: 'BAD_REQUEST', message: 'No files were successfully processed.' });
      return { message: 'Files uploaded successfully!', files: uploadedFileResults };
    }
  }),

  getDashboardStats: defineAction({
    handler: async (_, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV namespace not found.' });
      try {
        const imageListResult = await IMGBED_KV.list({ prefix: 'image:' });
        const apiKeyListResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
        let activeApiKeyCount = 0;
        interface ApiKeyListMetadata { status?: 'active' | 'revoked'; }
        for (const key of apiKeyListResult.keys) {
          const metadata = key.metadata as ApiKeyListMetadata | undefined | null;
          if (metadata?.status === 'active') activeApiKeyCount++;
        }
        return { totalImageCount: imageListResult.keys.length, activeApiKeyCount };
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to retrieve dashboard statistics: ${e.message || e}` });
      }
    }
  }),

  listApiKeys: defineAction({
    handler: async (_, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });
      try {
        const listResult = await IMGBED_KV.list({ prefix: 'apikey_record:' });
        const userApiKeys: Partial<ApiKeyRecord>[] = [];
        for (const kvKey of listResult.keys) {
          const recordString = await IMGBED_KV.get(kvKey.name);
          if (recordString) {
            try {
              const record = JSON.parse(recordString) as ApiKeyRecord;
              if (record.userId === user.userId && record.status === 'active') {
                userApiKeys.push({
                  id: record.id, name: record.name, keyPrefix: record.keyPrefix, createdAt: record.createdAt,
                  lastUsedAt: record.lastUsedAt, permissions: record.permissions,
                });
              }
            } catch (parseError) { console.error(`Action listApiKeys: Failed to parse API key record ${kvKey.name}:`, parseError); }
          }
        }
        return userApiKeys;
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to retrieve API keys: ${e.message || e}` });
      }
    }
  }),

  createApiKey: defineAction({
    input: z.object({ name: z.string().optional(), permissions: z.array(z.string()).optional() }),
    handler: async (input, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });

      const keyName = input.name?.trim() || `API Key ${nanoid(5)}`;
      const permissions = input.permissions || ['upload'];
      const keyId = nanoid(16);
      const publicIdPart = nanoid(12);
      const secretKeyPart = nanoid(32);
      const keyPrefix = `imgbed_sk_${publicIdPart}`;
      const fullApiKey = `${keyPrefix}_${secretKeyPart}`;
      const hashedFullApiKey = await simpleHash(fullApiKey);
      const newApiKeyRecord: ApiKeyRecord = {
        id: keyId, name: keyName, userId: user.userId, keyPrefix, hashedKey: hashedFullApiKey,
        createdAt: new Date().toISOString(), permissions, status: 'active',
      };
      try {
        await IMGBED_KV.put(`apikey_record:${keyId}`, JSON.stringify(newApiKeyRecord), { metadata: { status: newApiKeyRecord.status, userId: newApiKeyRecord.userId } });
        await IMGBED_KV.put(`apikey_public_id:${publicIdPart}`, keyId);
        return {
          message: 'API Key generated successfully. Store it securely, it will not be shown again.', apiKey: fullApiKey,
          record: { id: newApiKeyRecord.id, name: newApiKeyRecord.name, keyPrefix: newApiKeyRecord.keyPrefix, createdAt: newApiKeyRecord.createdAt, permissions: newApiKeyRecord.permissions, status: newApiKeyRecord.status }
        };
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to generate API key: ${e.message || e}` });
      }
    }
  }),

  revokeApiKey: defineAction({
    input: z.object({ keyId: z.string() }),
    handler: async ({ keyId }, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });
      if (!keyId) throw new ActionError({ code: 'BAD_REQUEST', message: 'Missing keyId' });
      try {
        const recordKey = `apikey_record:${keyId}`;
        const recordString = await IMGBED_KV.get(recordKey);
        if (!recordString) throw new ActionError({ code: 'NOT_FOUND', message: 'API Key not found' });
        const record = JSON.parse(recordString) as ApiKeyRecord;
        if (record.userId !== user.userId) throw new ActionError({ code: 'FORBIDDEN', message: 'Forbidden' });
        record.status = 'revoked';
        await IMGBED_KV.put(recordKey, JSON.stringify(record), { metadata: { status: record.status, userId: record.userId } });
        return { message: 'API Key revoked successfully' };
      } catch (e: any) {
        if (e instanceof ActionError) throw e;
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to revoke API key: ${e.message || e}` });
      }
    }
  }),

  listDirectoryContents: defineAction({
    input: z.object({ path: z.string().optional() }),
    handler: async ({ path: requestedPath = '' }, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });
      const currentPathNormalized = requestedPath.trim().replace(/^\/+|\/+$/g, '');
      try {
        const listResult = await IMGBED_KV.list({ prefix: 'image:' });
        const allImages: ImageMetadata[] = [];
        for (const key of listResult.keys) {
          const metadataString = await IMGBED_KV.get(key.name);
          if (metadataString) {
            try { allImages.push(JSON.parse(metadataString) as ImageMetadata); } catch (e) { console.error(`Action listDirectoryContents: Failed to parse metadata for key ${key.name}:`, e); }
          }
        }
        const itemsInDirectory: ImageMetadata[] = [];
        const subdirectories = new Set<string>();
        allImages.forEach(image => {
          const imageNormalizedUploadPath = (image.uploadPath || '').trim().replace(/^\/+|\/+$/g, '');
          if (currentPathNormalized === '') {
            if (imageNormalizedUploadPath === '') itemsInDirectory.push(image);
            else subdirectories.add(imageNormalizedUploadPath.split('/')[0]);
          } else {
            if (imageNormalizedUploadPath === currentPathNormalized) itemsInDirectory.push(image);
            else if (imageNormalizedUploadPath.startsWith(currentPathNormalized + '/')) {
              const relativePath = imageNormalizedUploadPath.substring(currentPathNormalized.length + 1);
              subdirectories.add(relativePath.split('/')[0]);
            }
          }
        });
        itemsInDirectory.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        const currentDirectoryTotalSize = itemsInDirectory.reduce((sum, image) => sum + (image.size || 0), 0);
        return { path: currentPathNormalized, images: itemsInDirectory, directories: Array.from(subdirectories).sort(), currentDirectoryTotalSize };
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to retrieve directory contents: ${e.message || e}` });
      }
    }
  }),

  deleteImagesAction: defineAction({
    input: z.object({ imageIds: z.array(z.string()) }),
    handler: async ({ imageIds }, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
      if (!IMGBED_KV || !IMGBED_R2) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV or R2 Namespace not found.' });
      if (!imageIds || imageIds.length === 0) return { message: 'No image IDs provided to delete.', results: { deleted: [], failed: [] } };
      const results = { deleted: [] as string[], failed: [] as { id: string; reason: string }[] };
      for (const imageId of imageIds) {
        const metadataKey = `image:${imageId}`;
        try {
          const metadataString = await IMGBED_KV.get(metadataKey);
          if (!metadataString) { results.failed.push({ id: imageId, reason: 'Image metadata not found in KV.' }); continue; }
          const metadata = JSON.parse(metadataString) as ImageMetadata;
          await IMGBED_R2.delete(metadata.r2Key);
          await IMGBED_KV.delete(metadataKey);
          results.deleted.push(imageId);
        } catch (e: any) { results.failed.push({ id: imageId, reason: e.message || 'Unknown error during deletion' }); }
      }
      if (results.failed.length > 0 && results.deleted.length === 0) {
        const failureReasons = results.failed.map(f => `${f.id}: ${f.reason}`).join('; ');
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to delete any of the specified images. Errors: ${failureReasons}` });
      }
      return { message: 'Image deletion process completed.', results };
    }
  }),

  moveImagesAction: defineAction({
    input: z.object({ imageIds: z.array(z.string()), targetDirectory: z.string() }),
    handler: async ({ imageIds, targetDirectory }, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
      if (!IMGBED_KV || !IMGBED_R2) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV or R2 Namespace not found.' });
      const normalizedTargetDir = targetDirectory.trim().replace(/^\/+|\/+$/g, '');
      if (!imageIds || imageIds.length === 0) return { message: 'No image IDs provided to move.', results: { moved: [], failed: [] } };
      const results = { moved: [] as { id: string; newR2Key: string }[], failed: [] as { id: string; reason: string }[] };
      for (const imageId of imageIds) {
        const metadataKey = `image:${imageId}`;
        try {
          const metadataString = await IMGBED_KV.get(metadataKey);
          if (!metadataString) { results.failed.push({ id: imageId, reason: 'Image metadata not found in KV.' }); continue; }
          const metadata = JSON.parse(metadataString) as ImageMetadata;
          const currentImageDir = (metadata.uploadPath || '').trim().replace(/^\/+|\/+$/g, '');
          if (currentImageDir === normalizedTargetDir) continue;
          const oldR2Key = metadata.r2Key;
          const fileNameParts = metadata.fileName.split('.');
          const fileExtension = fileNameParts.length > 1 ? `.${fileNameParts.pop()}` : '';
          const newR2ObjectKey = normalizedTargetDir ? `${normalizedTargetDir}/${imageId}${fileExtension}` : `${imageId}${fileExtension}`;
          const r2Object = await IMGBED_R2.get(oldR2Key);
          if (!r2Object) {
            results.failed.push({ id: imageId, reason: `R2 object not found at ${oldR2Key}.` });
            await IMGBED_KV.delete(metadataKey); continue;
          }
          const objectBodyArrayBuffer = await r2Object.arrayBuffer();
          await IMGBED_R2.put(newR2ObjectKey, objectBodyArrayBuffer, { httpMetadata: r2Object.httpMetadata, customMetadata: (r2Object as any).customMetadata });
          const updatedMetadata: ImageMetadata = { ...metadata, r2Key: newR2ObjectKey, uploadPath: normalizedTargetDir || undefined };
          await IMGBED_KV.put(metadataKey, JSON.stringify(updatedMetadata));
          await IMGBED_R2.delete(oldR2Key);
          results.moved.push({ id: imageId, newR2Key: newR2ObjectKey });
        } catch (e: any) { results.failed.push({ id: imageId, reason: e.message || 'Unknown error during move' }); }
      }
      if (results.failed.length > 0 && results.moved.length === 0) {
        const failureReasons = results.failed.map(f => `${f.id}: ${f.reason}`).join('; ');
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to move any of the specified images. Errors: ${failureReasons}` });
      }
      return { message: 'Image move process completed.', results };
    }
  }),

  getAppSettings: defineAction({
    handler: async (_, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });
      try {
        const settings: AppSettings = {};
        const defaultCopyFormat = await IMGBED_KV.get(CONFIG_KEYS.defaultCopyFormat);
        if (defaultCopyFormat) settings.defaultCopyFormat = defaultCopyFormat;
        const customImagePrefix = await IMGBED_KV.get(CONFIG_KEYS.customImagePrefix);
        if (customImagePrefix !== null) settings.customImagePrefix = customImagePrefix;
        const enableHotlinkProtectionStr = await IMGBED_KV.get(CONFIG_KEYS.enableHotlinkProtection);
        if (enableHotlinkProtectionStr) settings.enableHotlinkProtection = enableHotlinkProtectionStr === 'true';
        const allowedDomainsStr = await IMGBED_KV.get(CONFIG_KEYS.allowedDomains);
        if (allowedDomainsStr) {
          try { settings.allowedDomains = JSON.parse(allowedDomainsStr) as string[]; } catch (e) { settings.allowedDomains = []; }
        } else { settings.allowedDomains = []; }
        const siteDomain = await IMGBED_KV.get(CONFIG_KEYS.siteDomain);
        if (siteDomain !== null) settings.siteDomain = siteDomain;
        return settings;
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to retrieve settings: ${e.message || e}` });
      }
    }
  }),

  updateAppSettings: defineAction({
    input: z.object({
      defaultCopyFormat: z.string().optional(),
      customImagePrefix: z.string().optional(),
      enableHotlinkProtection: z.boolean().optional(),
      allowedDomains: z.array(z.string()).optional(),
      siteDomain: z.string().optional(),
    }).partial(),
    handler: async (newSettings, { locals }) => {
      const user = locals.user;
      if (!user) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      const { IMGBED_KV } = locals.runtime.env;
      if (!IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error: KV Namespace not found.' });
      try {
        const kvOperations: Promise<void>[] = [];
        if (Object.prototype.hasOwnProperty.call(newSettings, 'defaultCopyFormat')) {
          kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.defaultCopyFormat, newSettings.defaultCopyFormat!));
        }
        if (Object.prototype.hasOwnProperty.call(newSettings, 'customImagePrefix')) {
          kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.customImagePrefix, (newSettings.customImagePrefix || "").trim()));
        }
        if (Object.prototype.hasOwnProperty.call(newSettings, 'enableHotlinkProtection')) {
          kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.enableHotlinkProtection, String(newSettings.enableHotlinkProtection)));
        }
        if (Object.prototype.hasOwnProperty.call(newSettings, 'allowedDomains')) {
          const validDomains = (newSettings.allowedDomains || []).map(d => String(d).trim()).filter(d => d.length > 0);
          kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.allowedDomains, JSON.stringify(validDomains)));
        }
        if (Object.prototype.hasOwnProperty.call(newSettings, 'siteDomain')) {
          kvOperations.push(IMGBED_KV.put(CONFIG_KEYS.siteDomain, (newSettings.siteDomain || "").trim()));
        }
        await Promise.all(kvOperations);
        return { message: 'Settings updated successfully' };
      } catch (e: any) {
        throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to update settings: ${e.message || e}` });
      }
    }
  }),
};
