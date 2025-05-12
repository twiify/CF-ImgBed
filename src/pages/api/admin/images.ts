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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV } = locals.runtime.env;
  if (!IMGBED_KV) {
    console.error('Images GET: IMGBED_KV not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const requestedPath = url.searchParams.get('path') || ''; // Current directory path from query param, defaults to root.
  const currentPathNormalized = requestedPath.trim().replace(/^\/+|\/+$/g, ''); // Normalize path (remove leading/trailing slashes)

  try {
    // Performance Note: Listing ALL 'image:' prefixed keys and then filtering in memory can be inefficient
    // for a very large number of total images. A more scalable solution might involve:
    // 1. Storing images with keys that include their full path, e.g., `image_path:${uploadPath}/${id}`.
    // 2. Maintaining separate KV entries for directory listings, e.g., `dir_content:${path}` -> JSON array of image IDs and subdirs.
    // This current approach is simpler for a moderate number of images.
    const listResult = await IMGBED_KV.list({ prefix: 'image:' });
    
    const allImages: ImageMetadata[] = [];
    for (const key of listResult.keys) {
      const metadataString = await IMGBED_KV.get(key.name);
      if (metadataString) {
        try {
          allImages.push(JSON.parse(metadataString) as ImageMetadata);
        } catch (e) { console.error(`Images GET: Failed to parse metadata for key ${key.name}:`, e); }
      }
    }

    // Filter images for the current directory and discover immediate subdirectories.
    const itemsInDirectory: ImageMetadata[] = [];
    const subdirectories = new Set<string>();

    allImages.forEach(image => {
      const imageNormalizedUploadPath = (image.uploadPath || '').trim().replace(/^\/+|\/+$/g, '');

      if (currentPathNormalized === '') { // We are at the root directory ("")
        if (imageNormalizedUploadPath === '') {
          // Image is directly in the root
          itemsInDirectory.push(image);
        } else {
          // Image is in a subdirectory of root. Add the first segment of its path.
          subdirectories.add(imageNormalizedUploadPath.split('/')[0]);
        }
      } else { // We are in a subdirectory (currentPathNormalized is not empty)
        if (imageNormalizedUploadPath === currentPathNormalized) {
          // Image is directly in this current subdirectory
          itemsInDirectory.push(image);
        } else if (imageNormalizedUploadPath.startsWith(currentPathNormalized + '/')) {
          // Image is in a deeper path relative to the current subdirectory.
          // Extract the path segment immediately following currentPathNormalized.
          const relativePath = imageNormalizedUploadPath.substring(currentPathNormalized.length + 1); // +1 for the '/'
          subdirectories.add(relativePath.split('/')[0]);
        }
        // Images not matching either condition are not in or under the current directory, so they are ignored.
      }
    });
    
    // Sort images by upload date descending (most recent first)
    itemsInDirectory.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    // Calculate total size of images directly within the current directory
    const currentDirectoryTotalSize = itemsInDirectory.reduce((sum, image) => sum + (image.size || 0), 0);

    return new Response(JSON.stringify({
      path: currentPathNormalized,
      images: itemsInDirectory,
      directories: Array.from(subdirectories).sort(), // Sort directory names alphabetically
      currentDirectoryTotalSize,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error(`Images GET: Error listing images for path '${requestedPath}':`, e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Failed to retrieve images', details: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// DELETE: Delete one or more images
export const DELETE: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
  if (!IMGBED_KV || !IMGBED_R2) {
    console.error('Images DELETE: KV or R2 not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV or R2 Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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

  const imageIdsToDelete = payload.imageIds as string[]; // Already validated as array of strings
  if (imageIdsToDelete.length === 0) {
    return new Response(JSON.stringify({ message: 'No image IDs provided to delete.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const results = {
    deleted: [] as string[],
    failed: [] as { id: string; reason: string }[],
  };

  for (const imageId of imageIdsToDelete) {
    const metadataKey = `image:${imageId}`;
    try {
      const metadataString = await IMGBED_KV.get(metadataKey);
      if (!metadataString) {
        results.failed.push({ id: imageId, reason: 'Image metadata not found in KV.' });
        continue;
      }
      const metadata = JSON.parse(metadataString) as ImageMetadata;

      // 1. Delete the object from R2 storage
      await IMGBED_R2.delete(metadata.r2Key);
      
      // 2. Delete the metadata from KV
      await IMGBED_KV.delete(metadataKey);
      
      // TODO: Consider if any other indexes related to this image need cleanup (e.g., if using user-specific image lists).

      results.deleted.push(imageId);
    } catch (e: any) {
      console.error(`Images DELETE: Error deleting image ${imageId}:`, e.message, e.stack);
      results.failed.push({ id: imageId, reason: e.message || 'Unknown error during deletion' });
    }
  }

  if (results.failed.length > 0 && results.deleted.length === 0) {
     return new Response(JSON.stringify({ error: 'Failed to delete any of the specified images.', details: results }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ message: 'Image deletion process completed.', results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// PATCH: Move one or more images to a new directory
export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
  if (!IMGBED_KV || !IMGBED_R2) {
    console.error('Images PATCH: KV or R2 not available.');
    return new Response(JSON.stringify({ error: 'Server configuration error: KV or R2 Namespace not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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

  const { imageIds, targetDirectory } = payload; // Validated by try-catch block
  const normalizedTargetDir = targetDirectory!.trim().replace(/^\/+|\/+$/g, ''); // targetDirectory is now guaranteed to be a string

  if (imageIds!.length === 0) {
    return new Response(JSON.stringify({ message: 'No image IDs provided to move.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const results = {
    moved: [] as { id: string; newR2Key: string }[],
    failed: [] as { id: string; reason: string }[],
  };

  for (const imageId of imageIds!) {
    const metadataKey = `image:${imageId}`;
    try {
      const metadataString = await IMGBED_KV.get(metadataKey);
      if (!metadataString) {
        results.failed.push({ id: imageId, reason: 'Image metadata not found in KV.' });
        continue;
      }
      const metadata = JSON.parse(metadataString) as ImageMetadata;
      
      const currentImageDir = (metadata.uploadPath || '').trim().replace(/^\/+|\/+$/g, '');
      if (currentImageDir === normalizedTargetDir) { // Image is already in the target directory
        // Optionally, count as moved or just skip as a no-op.
        // For clarity, we'll skip and not report as moved or failed.
        continue;
      }

      const oldR2Key = metadata.r2Key;
      // Extract file extension more robustly
      const fileNameParts = metadata.fileName.split('.');
      const fileExtension = fileNameParts.length > 1 ? `.${fileNameParts.pop()}` : '';
      
      const newR2ObjectKey = normalizedTargetDir ? `${normalizedTargetDir}/${imageId}${fileExtension}` : `${imageId}${fileExtension}`;

      // R2 "move" operation: Copy the object to the new key, then delete the old object.
      const r2Object = await IMGBED_R2.get(oldR2Key);
      if (!r2Object) {
        results.failed.push({ id: imageId, reason: `R2 object not found at ${oldR2Key}. KV metadata might be out of sync.` });
        // Consider deleting the orphaned KV entry to maintain consistency
        await IMGBED_KV.delete(metadataKey); 
        continue;
      }
      
      // Get the object's body as ArrayBuffer to ensure correct ContentLength for PUT
      const objectBodyArrayBuffer = await r2Object.arrayBuffer();
      
      // PUT the object to the new R2 key
      await IMGBED_R2.put(newR2ObjectKey, objectBodyArrayBuffer, {
        httpMetadata: r2Object.httpMetadata, // Preserve original HTTP metadata (like ContentType)
        customMetadata: (r2Object as any).customMetadata, // Preserve any custom R2 metadata
      });

      // Update metadata in KV with the new r2Key and uploadPath
      const updatedMetadata: ImageMetadata = {
        ...metadata,
        r2Key: newR2ObjectKey,
        uploadPath: normalizedTargetDir || undefined, // Store empty string (root) as undefined for consistency
      };
      // TODO: If image metadata in KV also has its own 'metadata' field for dashboard stats (e.g. status), update it here too.
      // Currently, image metadata doesn't seem to have such a field.
      await IMGBED_KV.put(metadataKey, JSON.stringify(updatedMetadata));

      // DELETE the old R2 object (only after successful PUT to new location and KV update)
      await IMGBED_R2.delete(oldR2Key);

      results.moved.push({ id: imageId, newR2Key: newR2ObjectKey });

    } catch (e: any) {
      console.error(`Images PATCH: Error moving image ${imageId} to '${normalizedTargetDir}':`, e.message, e.stack);
      results.failed.push({ id: imageId, reason: e.message || 'Unknown error during move operation' });
    }
  }
  
  if (results.failed.length > 0 && results.moved.length === 0) {
     return new Response(JSON.stringify({ error: 'Failed to move any of the specified images.', details: results }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ message: 'Image move process completed.', results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// TODO: Implement API endpoints for directory operations (e.g., move directory, delete directory).
// Deleting a directory would involve listing all images within that path (recursively) and deleting them.
// Moving a directory would involve updating the `uploadPath` for all images within that path.
