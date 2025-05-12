import type { APIRoute } from 'astro';

// Re-use or import ImageMetadata type
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

// GET: List images and directories for a given path
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  // Basic pagination (can be enhanced with cursor from KV list options)
  const requestedPath = url.searchParams.get('path') || ''; // Current directory path, default to root

  try {
    const listResult = await IMGBED_KV.list({ prefix: 'image:' });
    
    const allImages: ImageMetadata[] = [];
    for (const key of listResult.keys) {
      const metadataString = await IMGBED_KV.get(key.name);
      if (metadataString) {
        try {
          allImages.push(JSON.parse(metadataString) as ImageMetadata);
        } catch (e) { console.error(`Failed to parse metadata for key ${key.name}:`, e); }
      }
    }

    // Filter images and discover subdirectories for the requestedPath
    const currentPathNormalized = requestedPath.trim().replace(/^\/+|\/+$/g, '');
    const itemsInDirectory: ImageMetadata[] = [];
    const subdirectories = new Set<string>();

    allImages.forEach(image => {
      const imageUploadPath = (image.uploadPath || '').trim().replace(/^\/+|\/+$/g, '');
      
      if (currentPathNormalized === '') { // Root directory
        if (imageUploadPath === '') { // Image is in root
          itemsInDirectory.push(image);
        } else { // Image is in a subdirectory, extract top-level dir
          subdirectories.add(imageUploadPath.split('/')[0]);
        }
      } else { // Specific directory
        if (imageUploadPath.startsWith(currentPathNormalized)) {
          const remainingPath = imageUploadPath.substring(currentPathNormalized.length).replace(/^\//, '');
          if (remainingPath === '') { // Image is directly in this directory
            itemsInDirectory.push(image);
          } else { // Image is in a deeper subdirectory
            subdirectories.add(remainingPath.split('/')[0]);
          }
        }
      }
    });
    
    // Sort images by upload date descending
    itemsInDirectory.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    // Calculate total size of images in the current directory
    const currentDirectoryTotalSize = itemsInDirectory.reduce((sum, image) => sum + (image.size || 0), 0);

    return new Response(JSON.stringify({
      path: currentPathNormalized,
      images: itemsInDirectory,
      directories: Array.from(subdirectories).sort(),
      currentDirectoryTotalSize,
    }), { status: 200 });

  } catch (e: any) {
    console.error(`Error listing images for path '${requestedPath}':`, e);
    return new Response(JSON.stringify({ error: 'Failed to retrieve images', details: e.message }), { status: 500 });
  }
};

// DELETE: Delete images
export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
  if (!IMGBED_KV || !IMGBED_R2) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  let payload: { imageIds?: string[] }; // Expect an array of image IDs to delete
  try {
    payload = await request.json();
    if (!payload || !Array.isArray(payload.imageIds) || payload.imageIds.some(id => typeof id !== 'string')) {
      throw new Error('Invalid payload: imageIds must be an array of strings.');
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Invalid request body', details: e.message }), { status: 400 });
  }

  const imageIdsToDelete = payload.imageIds as string[];
  if (imageIdsToDelete.length === 0) {
    return new Response(JSON.stringify({ message: 'No image IDs provided to delete.' }), { status: 200 });
  }

  const results = {
    deleted: [] as string[],
    failed: [] as { id: string; reason: string }[],
  };

  for (const imageId of imageIdsToDelete) {
    try {
      const metadataKey = `image:${imageId}`;
      const metadataString = await IMGBED_KV.get(metadataKey);
      if (!metadataString) {
        results.failed.push({ id: imageId, reason: 'Metadata not found.' });
        continue;
      }
      const metadata = JSON.parse(metadataString) as ImageMetadata;

      // Delete from R2
      await IMGBED_R2.delete(metadata.r2Key);
      
      // Delete metadata from KV
      await IMGBED_KV.delete(metadataKey);
      // If other indexes exist (e.g., r2key:), delete them too.

      results.deleted.push(imageId);
    } catch (e: any) {
      console.error(`Error deleting image ${imageId}:`, e);
      results.failed.push({ id: imageId, reason: e.message || 'Unknown error' });
    }
  }

  if (results.failed.length > 0 && results.deleted.length === 0) {
     return new Response(JSON.stringify({ error: 'Failed to delete any images.', details: results }), { status: 500 });
  }
  return new Response(JSON.stringify({ message: 'Deletion process completed.', results }), { status: 200 });
};

// PATCH: Move images to a new directory
export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
  if (!IMGBED_KV || !IMGBED_R2) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500 });
  }

  let payload: { imageIds?: string[]; targetDirectory?: string };
  try {
    payload = await request.json();
    if (
      !payload || 
      !Array.isArray(payload.imageIds) || 
      payload.imageIds.some(id => typeof id !== 'string') ||
      typeof payload.targetDirectory !== 'string'
    ) {
      throw new Error('Invalid payload: imageIds must be an array of strings and targetDirectory must be a string.');
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Invalid request body', details: e.message }), { status: 400 });
  }

  const { imageIds, targetDirectory } = payload;
  const normalizedTargetDir = targetDirectory.trim().replace(/^\/+|\/+$/g, '');

  if (imageIds.length === 0) {
    return new Response(JSON.stringify({ message: 'No image IDs provided to move.' }), { status: 200 });
  }

  const results = {
    moved: [] as { id: string; newR2Key: string }[],
    failed: [] as { id: string; reason: string }[],
  };

  for (const imageId of imageIds) {
    const metadataKey = `image:${imageId}`;
    try {
      const metadataString = await IMGBED_KV.get(metadataKey);
      if (!metadataString) {
        results.failed.push({ id: imageId, reason: 'Metadata not found.' });
        continue;
      }
      const metadata = JSON.parse(metadataString) as ImageMetadata;
      
      if (metadata.uploadPath === normalizedTargetDir) { // Already in target directory
        // results.moved.push({ id: imageId, newR2Key: metadata.r2Key }); // Or treat as no-op
        continue;
      }

      const oldR2Key = metadata.r2Key;
      const fileExtension = metadata.fileName.includes('.') ? `.${metadata.fileName.split('.').pop()}` : '';
      const newR2ObjectKey = normalizedTargetDir ? `${normalizedTargetDir}/${imageId}${fileExtension}` : `${imageId}${fileExtension}`;

      // R2 "move" is copy then delete
      const r2Object = await IMGBED_R2.get(oldR2Key);
      if (!r2Object) {
        results.failed.push({ id: imageId, reason: `R2 object not found at ${oldR2Key}. KV might be out of sync.` });
        // Potentially clean up KV entry here or mark as orphaned
        await IMGBED_KV.delete(metadataKey); 
        continue;
      }
      
      // Read the full body into an ArrayBuffer first to ensure known length
      const objectBodyArrayBuffer = await r2Object.arrayBuffer();
      
      // Copy to new location using ArrayBuffer
      await IMGBED_R2.put(newR2ObjectKey, objectBodyArrayBuffer, {
        httpMetadata: r2Object.httpMetadata, // Preserve existing httpMetadata
        customMetadata: (r2Object as any).customMetadata, // Preserve customMetadata if any
        // No 'size' option here as it's inferred from ArrayBuffer
      });

      // Update metadata in KV
      const updatedMetadata: ImageMetadata = {
        ...metadata,
        r2Key: newR2ObjectKey,
        uploadPath: normalizedTargetDir || undefined, // Store empty string as undefined
      };
      await IMGBED_KV.put(metadataKey, JSON.stringify(updatedMetadata));

      // Delete old R2 object (only after successful put and KV update)
      await IMGBED_R2.delete(oldR2Key);

      results.moved.push({ id: imageId, newR2Key: newR2ObjectKey });

    } catch (e: any) {
      console.error(`Error moving image ${imageId} to ${normalizedTargetDir}:`, e);
      results.failed.push({ id: imageId, reason: e.message || 'Unknown error during move' });
    }
  }
  
  if (results.failed.length > 0 && results.moved.length === 0) {
     return new Response(JSON.stringify({ error: 'Failed to move any images.', details: results }), { status: 500 });
  }
  return new Response(JSON.stringify({ message: 'Move process completed.', results }), { status: 200 });
};
