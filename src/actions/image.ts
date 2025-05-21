import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { nanoid } from 'nanoid';
import type { ImageMetadata, ApiKeyRecord, AppSettings } from '~/lib/consts';
import { isValidApiKeyInternal, sanitizePathSegment } from '~/lib/utils';
import {
    DEFAULT_MAX_FILE_SIZE_MB,
    DEFAULT_MAX_FILES_PER_UPLOAD,
    ALLOWED_MIME_TYPES,
    APP_SETTINGS_KEY,
} from '~/lib/consts';

export const image = {
    upload: defineAction({
        accept: 'form',
        input: z.object({
            uploadDirectory: z.string().optional(),
        }),
        handler: async (input, context) => {
            const { locals, request } = context;
            const { IMGBED_R2, IMGBED_KV } = locals.runtime.env;
            const user = locals.user;

            const apiKeyHeader = request.headers.get('X-API-Key');
            let apiKeyDetails: false | Pick<ApiKeyRecord, 'userId' | 'id'> =
                false;

            if (!user) {
                apiKeyDetails = await isValidApiKeyInternal(
                    apiKeyHeader,
                    IMGBED_KV,
                );
                if (!apiKeyDetails)
                    throw new ActionError({
                        code: 'UNAUTHORIZED',
                        message: 'Unauthorized',
                    });
            }
            if (!IMGBED_R2 || !IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Server configuration error',
                });

            const appSettingStr =
                (await IMGBED_KV.get(APP_SETTINGS_KEY)) || '{}';
            const appSettings: AppSettings = JSON.parse(appSettingStr);

            const maxFileSizeMb =
                appSettings.uploadMaxFileSizeMb || DEFAULT_MAX_FILE_SIZE_MB;
            const maxFilesPerUpload =
                appSettings.uploadMaxFilesPerUpload ||
                DEFAULT_MAX_FILES_PER_UPLOAD;

            const MAX_FILE_SIZE_BYTES = maxFileSizeMb * 1024 * 1024;
            const MAX_FILES_PER_UPLOAD = maxFilesPerUpload;

            const formData = await request.formData();
            // formData.getAll() returns (File | string)[]. filter for File instances.
            const filesFromForm = formData.getAll('files');
            let filesToProcess: File[] = filesFromForm.filter(
                (f): f is File => f instanceof File,
            );

            if (filesToProcess.length === 0) {
                throw new ActionError({
                    code: 'BAD_REQUEST',
                    message: 'No files uploaded or files key is missing.',
                });
            }

            if (filesToProcess.length > MAX_FILES_PER_UPLOAD) {
                throw new ActionError({
                    code: 'BAD_REQUEST',
                    message: `Too many files. Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload.`,
                });
            }

            const rawUploadDirectory = input.uploadDirectory;
            const saneUploadDir = sanitizePathSegment(rawUploadDirectory);

            const processedFileResults: Array<{
                success: boolean;
                fileName: string;
                data?: ImageMetadata & { url: string };
                message?: string;
            }> = [];
            let allSuccess = true;
            let someSuccess = false;

            for (const file of filesToProcess) {
                if (!(file instanceof File) || file.size === 0) {
                    // This case should ideally be caught by client-side validation too
                    processedFileResults.push({
                        success: false,
                        fileName: file.name || 'unknown_file',
                        message: 'File is empty or not a valid file.',
                    });
                    allSuccess = false;
                    continue;
                }

                // File Size Check
                if (file.size > MAX_FILE_SIZE_BYTES) {
                    processedFileResults.push({
                        success: false,
                        fileName: file.name,
                        message: `File size exceeds limit of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
                    });
                    allSuccess = false;
                    continue;
                }

                // MIME Type Check
                if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                    processedFileResults.push({
                        success: false,
                        fileName: file.name,
                        message: `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}.`,
                    });
                    allSuccess = false;
                    continue;
                }

                try {
                    const fileBuffer = await file.arrayBuffer();
                    const imageId = nanoid(10);
                    const fileExtension = file.name.includes('.')
                        ? `.${file.name.split('.').pop()}`
                        : '';
                    let r2ObjectKey = `${imageId}${fileExtension}`;

                    if (saneUploadDir) {
                        r2ObjectKey = `${saneUploadDir}/${imageId}${fileExtension}`;
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
                        userId:
                            user?.userId ||
                            (apiKeyDetails ? apiKeyDetails.userId : undefined),
                        uploadPath: saneUploadDir || undefined,
                    };
                    await IMGBED_KV.put(
                        `image:${imageId}`,
                        JSON.stringify(metadata),
                    );
                    let baseUrl =
                        appSettings.siteDomain?.trim() ||
                        new URL(request.url).origin;
                    if (
                        baseUrl &&
                        !baseUrl.startsWith('http://') &&
                        !baseUrl.startsWith('https://')
                    )
                        baseUrl = 'https://' + baseUrl;
                    baseUrl = baseUrl.replace(/\/$/, '');
                    const imageAccessPrefix =
                        appSettings.customImagePrefix || 'img';
                    const prefixPath = imageAccessPrefix
                        .trim()
                        .replace(/^\/+|\/+$/g, '');
                    const publicUrl = `${baseUrl}/${prefixPath ? prefixPath + '/' : ''}${imageId}${fileExtension}`;
                    processedFileResults.push({
                        success: true,
                        fileName: file.name,
                        data: { ...metadata, url: publicUrl },
                    });
                    someSuccess = true;
                } catch (e: any) {
                    console.error(
                        `Action upload: Failed to upload ${file.name}:`,
                        e,
                    );
                    processedFileResults.push({
                        success: false,
                        fileName: file.name,
                        message: e.message || 'Unknown error',
                    });
                    allSuccess = false;
                }
            }

            const successfulUploads = processedFileResults.filter(
                (r) => r.success,
            );
            // const failedUploads = processedFileResults.filter(r => !r.success);

            if (!someSuccess) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR', // Or BAD_REQUEST depending on context
                    message: 'All files failed to upload.',
                    // It might be useful to pass detailed results if ActionError can carry structured data
                    // For now, a general message. The console will have more details.
                });
            }

            return {
                success: allSuccess,
                message: allSuccess
                    ? `Successfully uploaded ${successfulUploads.length} files.`
                    : `Partially completed: ${successfulUploads.length} of ${filesToProcess.length} files uploaded.`,
                results: processedFileResults,
            };
        },
    }),
    listDirectoryContents: defineAction({
        input: z.object({ path: z.string().optional() }),
        handler: async ({ path: requestedPath = '' }, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });

            const currentPathNormalized = sanitizePathSegment(requestedPath);

            try {
                const listResult = await IMGBED_KV.list({ prefix: 'image:' });
                const allImages: ImageMetadata[] = [];
                for (const key of listResult.keys) {
                    const metadataString = await (IMGBED_KV as any).get(
                        key.name,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (metadataString) {
                        try {
                            allImages.push(
                                JSON.parse(metadataString) as ImageMetadata,
                            );
                        } catch (e) {
                            console.error(
                                `Action listDirectoryContents: Failed to parse metadata for key ${key.name}:`,
                                e,
                            );
                        }
                    }
                }
                const itemsInDirectory: ImageMetadata[] = [];
                const subdirectories = new Set<string>();
                allImages.forEach((image) => {
                    // Assuming image.uploadPath was stored sanitized previously.
                    // If not, it should also be sanitized here upon reading for comparison.
                    // For now, we assume it's stored correctly.
                    const imageNormalizedUploadPath = sanitizePathSegment(
                        image.uploadPath || '',
                    );

                    if (currentPathNormalized === '') {
                        if (imageNormalizedUploadPath === '')
                            itemsInDirectory.push(image);
                        else
                            subdirectories.add(
                                imageNormalizedUploadPath.split('/')[0],
                            );
                    } else {
                        if (imageNormalizedUploadPath === currentPathNormalized)
                            itemsInDirectory.push(image);
                        else if (
                            imageNormalizedUploadPath.startsWith(
                                currentPathNormalized + '/',
                            )
                        ) {
                            const relativePath =
                                imageNormalizedUploadPath.substring(
                                    currentPathNormalized.length + 1,
                                );
                            subdirectories.add(relativePath.split('/')[0]);
                        }
                    }
                });
                itemsInDirectory.sort(
                    (a, b) =>
                        new Date(b.uploadedAt).getTime() -
                        new Date(a.uploadedAt).getTime(),
                );
                const currentDirectoryTotalSize = itemsInDirectory.reduce(
                    (sum, image) => sum + (image.size || 0),
                    0,
                );
                return {
                    path: currentPathNormalized,
                    images: itemsInDirectory,
                    directories: Array.from(subdirectories).sort(),
                    currentDirectoryTotalSize,
                };
            } catch (e: any) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to retrieve directory contents: ${e.message || e}`,
                });
            }
        },
    }),

    deleteImagesAction: defineAction({
        input: z.object({ imageIds: z.array(z.string()) }),
        handler: async ({ imageIds }, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
            if (!IMGBED_KV || !IMGBED_R2)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV or R2 Namespace not found.',
                });
            if (!imageIds || imageIds.length === 0)
                return {
                    message: 'No image IDs provided to delete.',
                    results: { deleted: [], failed: [] },
                };
            const results = {
                deleted: [] as string[],
                failed: [] as { id: string; reason: string }[],
            };
            for (const imageId of imageIds) {
                const metadataKey = `image:${imageId}`;
                try {
                    const metadataString = await (IMGBED_KV as any).get(
                        metadataKey,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (!metadataString) {
                        results.failed.push({
                            id: imageId,
                            reason: 'Image metadata not found in KV.',
                        });
                        continue;
                    }
                    const metadata = JSON.parse(
                        metadataString,
                    ) as ImageMetadata;
                    await IMGBED_R2.delete(metadata.r2Key);
                    await IMGBED_KV.delete(metadataKey);
                    results.deleted.push(imageId);
                } catch (e: any) {
                    results.failed.push({
                        id: imageId,
                        reason: e.message || 'Unknown error during deletion',
                    });
                }
            }
            if (results.failed.length > 0 && results.deleted.length === 0) {
                const failureReasons = results.failed
                    .map((f) => `${f.id}: ${f.reason}`)
                    .join('; ');
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to delete any of the specified images. Errors: ${failureReasons}`,
                });
            }
            return { message: 'Image deletion process completed.', results };
        },
    }),

    moveImagesAction: defineAction({
        input: z.object({
            imageIds: z.array(z.string()),
            targetDirectory: z.string(),
        }),
        handler: async ({ imageIds, targetDirectory }, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV, IMGBED_R2 } = locals.runtime.env;
            if (!IMGBED_KV || !IMGBED_R2)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV or R2 Namespace not found.',
                });

            const normalizedTargetDir = sanitizePathSegment(targetDirectory);

            if (!imageIds || imageIds.length === 0)
                return {
                    message: 'No image IDs provided to move.',
                    results: { moved: [], failed: [] },
                };
            const results = {
                moved: [] as { id: string; newR2Key: string }[],
                failed: [] as { id: string; reason: string }[],
            };
            for (const imageId of imageIds) {
                const metadataKey = `image:${imageId}`;
                try {
                    const metadataString = await (IMGBED_KV as any).get(
                        metadataKey,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (!metadataString) {
                        results.failed.push({
                            id: imageId,
                            reason: 'Image metadata not found in KV.',
                        });
                        continue;
                    }
                    const metadata = JSON.parse(
                        metadataString,
                    ) as ImageMetadata;

                    // Assuming metadata.uploadPath was stored sanitized.
                    const currentImageDir = sanitizePathSegment(
                        metadata.uploadPath || '',
                    );

                    if (currentImageDir === normalizedTargetDir) continue;

                    const oldR2Key = metadata.r2Key;
                    const fileNameParts = metadata.fileName.split('.');
                    const fileExtension =
                        fileNameParts.length > 1
                            ? `.${fileNameParts.pop()}`
                            : '';
                    const newR2ObjectKey = normalizedTargetDir
                        ? `${normalizedTargetDir}/${imageId}${fileExtension}`
                        : `${imageId}${fileExtension}`;
                    const r2Object = await IMGBED_R2.get(oldR2Key);
                    if (!r2Object) {
                        results.failed.push({
                            id: imageId,
                            reason: `R2 object not found at ${oldR2Key}.`,
                        });
                        await IMGBED_KV.delete(metadataKey);
                        continue;
                    }
                    const objectBodyArrayBuffer = await r2Object.arrayBuffer();
                    await IMGBED_R2.put(newR2ObjectKey, objectBodyArrayBuffer, {
                        httpMetadata: r2Object.httpMetadata,
                        customMetadata: (r2Object as any).customMetadata,
                    });
                    const updatedMetadata: ImageMetadata = {
                        ...metadata,
                        r2Key: newR2ObjectKey,
                        uploadPath: normalizedTargetDir || undefined,
                    };
                    await IMGBED_KV.put(
                        metadataKey,
                        JSON.stringify(updatedMetadata),
                    );
                    await IMGBED_R2.delete(oldR2Key);
                    results.moved.push({
                        id: imageId,
                        newR2Key: newR2ObjectKey,
                    });
                } catch (e: any) {
                    results.failed.push({
                        id: imageId,
                        reason: e.message || 'Unknown error during move',
                    });
                }
            }
            if (results.failed.length > 0 && results.moved.length === 0) {
                const failureReasons = results.failed
                    .map((f) => `${f.id}: ${f.reason}`)
                    .join('; ');
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to move any of the specified images. Errors: ${failureReasons}`,
                });
            }
            return { message: 'Image move process completed.', results };
        },
    }),
};
