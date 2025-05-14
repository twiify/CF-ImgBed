import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { nanoid } from 'nanoid';
import type { ImageMetadata, ApiKeyRecord } from '~/lib/consts';
import { isValidApiKeyInternal } from '~/lib/utils';

export const image = {
  upload: defineAction({
    accept: 'form',
    // 'files' is removed from Zod input schema; will be handled manually from FormData
    input: z.object({
      uploadDirectory: z.string().optional(),
    }),
    handler: async (input, context) => { // 'input' now only contains 'uploadDirectory'
      const { locals, request } = context; // 'request' is context.request
      const { IMGBED_R2, IMGBED_KV } = locals.runtime.env;
      const user = locals.user;
      const apiKeyHeader = request.headers.get('X-API-Key');
      let apiKeyDetails: false | Pick<ApiKeyRecord, 'userId' | 'id'> = false;

      if (!user) {
        apiKeyDetails = await isValidApiKeyInternal(apiKeyHeader, IMGBED_KV);
        if (!apiKeyDetails) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      if (!IMGBED_R2 || !IMGBED_KV) throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server configuration error' });

      const formData = await request.formData();
      // formData.getAll() returns (File | string)[]. We need to filter for File instances.
      const filesFromForm = formData.getAll('files');
      const filesToProcess: File[] = filesFromForm.filter((f): f is File => f instanceof File);

      if (filesToProcess.length === 0) throw new ActionError({ code: 'BAD_REQUEST', message: 'No files uploaded or files key is missing.' });

      const uploadDirectory = input.uploadDirectory; // uploadDirectory is still from Zod-validated input
      const processedFileResults: Array<{ success: boolean; fileName: string; data?: ImageMetadata & { url: string }; message?: string }> = [];
      let allSuccess = true;
      let someSuccess = false;

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
          processedFileResults.push({ success: true, fileName: file.name, data: { ...metadata, url: publicUrl } });
          someSuccess = true;
        } catch (e: any) {
          console.error(`Action upload: Failed to upload ${file.name}:`, e);
          processedFileResults.push({ success: false, fileName: file.name, message: e.message || 'Unknown error' });
          allSuccess = false;
        }
      }

      const successfulUploads = processedFileResults.filter(r => r.success);
      // const failedUploads = processedFileResults.filter(r => !r.success);

      if (!someSuccess) { // All files failed
        throw new ActionError({
          code: 'INTERNAL_SERVER_ERROR', // Or BAD_REQUEST depending on context
          message: 'All files failed to upload.',
          // It might be useful to pass detailed results if ActionError can carry structured data
          // For now, a general message. The console will have more details.
        });
      }

      return {
        success: allSuccess, // True if all files succeeded, false if any failed
        message: allSuccess ? `Successfully uploaded ${successfulUploads.length} files.` : `Partially completed: ${successfulUploads.length} of ${filesToProcess.length} files uploaded.`,
        results: processedFileResults // Contains success/failure info for each file
      };
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
          const metadataString = await (IMGBED_KV as any).get(key.name, { type: "text", consistency: "strong" });
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
          const metadataString = await (IMGBED_KV as any).get(metadataKey, { type: "text", consistency: "strong" });
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
          const metadataString = await (IMGBED_KV as any).get(metadataKey, { type: "text", consistency: "strong" });
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
}