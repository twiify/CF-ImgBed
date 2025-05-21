import type { APIRoute } from 'astro';

// 从utils中导入辅助函数
import { isValidApiKeyInternal, sanitizePathSegment } from '~/lib/utils';
import {
    DEFAULT_MAX_FILES_PER_UPLOAD,
    DEFAULT_MAX_FILE_SIZE_MB,
    ALLOWED_MIME_TYPES,
    APP_SETTINGS_KEY,
} from '~/lib/consts';
import type { AppSettings } from '~/lib/consts';

// 处理 POST 请求
export const POST: APIRoute = async ({
    request,
    locals,
}): Promise<Response> => {
    const { IMGBED_R2, IMGBED_KV } = locals.runtime.env;

    // 检查环境变量是否设置
    if (!IMGBED_R2 || !IMGBED_KV) {
        return new Response(
            JSON.stringify({
                success: false,
                message: '服务器配置错误: 存储未配置',
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }

    // 检查认证
    const apiKeyHeader =
        request.headers.get('X-API-Key') ||
        request.headers.get('Authorization')?.replace('Bearer ', '') ||
        null;

    const apiKeyDetails = await isValidApiKeyInternal(apiKeyHeader, IMGBED_KV);
    if (!apiKeyDetails) {
        return new Response(
            JSON.stringify({
                success: false,
                message: '未授权: 无效的 API Key',
            }),
            {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }

    // 处理不同的内容类型
    try {
        const appSettingStr = (await IMGBED_KV.get(APP_SETTINGS_KEY)) || '{}';

        const appSettings: AppSettings = JSON.parse(appSettingStr);

        // Get configurable limits from KV store
        const maxFileSizeMb =
            appSettings.uploadMaxFileSizeMb || DEFAULT_MAX_FILE_SIZE_MB;
        const maxFilesPerUpload =
            appSettings.uploadMaxFilesPerUpload || DEFAULT_MAX_FILES_PER_UPLOAD;

        const MAX_FILE_SIZE_BYTES = maxFileSizeMb * 1024 * 1024;
        const MAX_FILES_PER_UPLOAD = maxFilesPerUpload;

        // 从nanoid导入
        const { nanoid } = await import('nanoid');

        let filesToProcess = [];
        let uploadDirectory = '';

        // 检查请求内容类型
        const contentType = request.headers.get('Content-Type') || '';

        if (contentType.includes('multipart/form-data')) {
            // 处理表单数据
            const formData = await request.formData();

            // 获取上传目录
            const rawUploadDirectoryFromForm =
                (formData.get('uploadDirectory') as string) || '';
            uploadDirectory = sanitizePathSegment(rawUploadDirectoryFromForm);

            // 获取文件
            const fileEntries = Array.from(formData.entries()).filter(
                ([key, value]) =>
                    value instanceof File && (value as File).size > 0,
            );

            filesToProcess = fileEntries.map(([_, file]) => file as File);
        } else if (contentType.includes('application/json')) {
            // 处理JSON格式的请求
            const jsonData = (await request.json()) as Record<string, any>;

            // 支持PicGo格式的请求
            if (jsonData.list && Array.isArray(jsonData.list)) {
                // PicGo发送的是base64格式的图片数据
                for (const item of jsonData.list) {
                    if (typeof item === 'string' && item.startsWith('data:')) {
                        try {
                            // 解析data URL
                            const matches = item.match(
                                /^data:([^;]+);base64,(.+)$/,
                            );
                            if (!matches || matches.length !== 3) {
                                continue;
                            }

                            const contentType = matches[1];
                            const base64Data = matches[2];
                            const binaryData = atob(base64Data);

                            // 创建ArrayBuffer
                            const buffer = new Uint8Array(binaryData.length);
                            for (let i = 0; i < binaryData.length; i++) {
                                buffer[i] = binaryData.charCodeAt(i);
                            }

                            // 确定文件扩展名
                            let extension = '';
                            if (contentType === 'image/jpeg')
                                extension = '.jpg';
                            else if (contentType === 'image/png')
                                extension = '.png';
                            else if (contentType === 'image/gif')
                                extension = '.gif';
                            else if (contentType === 'image/webp')
                                extension = '.webp';
                            else if (contentType === 'image/svg+xml')
                                extension = '.svg';
                            else extension = '.bin';

                            // 创建File对象
                            const fileName = `image${extension}`;
                            const file = new File([buffer], fileName, {
                                type: contentType,
                            });
                            filesToProcess.push(file);
                        } catch (e) {
                            console.error('处理base64图片数据失败:', e);
                        }
                    }
                }
            }

            // 从请求中获取上传目录
            const rawUploadDirFromJson =
                (jsonData.uploadDirectory as string) ||
                (jsonData.directory as string) ||
                '';
            uploadDirectory = sanitizePathSegment(rawUploadDirFromJson);
        } else {
            // 处理二进制数据
            try {
                const buffer = await request.arrayBuffer();
                if (buffer.byteLength > 0) {
                    // 从Content-Type确定文件类型
                    const fileType = contentType || 'application/octet-stream';

                    // 确定文件扩展名
                    let extension = '';
                    if (fileType === 'image/jpeg') extension = '.jpg';
                    else if (fileType === 'image/png') extension = '.png';
                    else if (fileType === 'image/gif') extension = '.gif';
                    else if (fileType === 'image/webp') extension = '.webp';
                    else if (fileType === 'image/svg+xml') extension = '.svg';
                    else extension = '.bin';

                    // 从URL获取文件名，如果在URL中提供了
                    let fileName =
                        new URL(request.url).searchParams.get('filename') ||
                        `image${extension}`;

                    // 创建File对象
                    const file = new File([buffer], fileName, {
                        type: fileType,
                    });
                    filesToProcess.push(file);

                    // 从URL获取上传目录
                    const rawUploadDirFromUrl =
                        new URL(request.url).searchParams.get('directory') ||
                        '';
                    uploadDirectory = sanitizePathSegment(rawUploadDirFromUrl);
                }
            } catch (e) {
                console.error('处理二进制数据失败:', e);
            }
        }

        // 检查是否有文件要处理
        if (filesToProcess.length === 0) {
            return new Response(
                JSON.stringify({
                    success: false,
                    message: '没有上传文件或文件格式错误',
                }),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        if (filesToProcess.length > MAX_FILES_PER_UPLOAD) {
            return new Response(
                JSON.stringify({
                    success: false,
                    message: `文件过多，每次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件`,
                }),
                {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        // uploadDirectory is already sanitized by this point from various sources

        // 处理文件上传
        const processedFileResults = [];
        let allSuccess = true;
        let someSuccess = false;

        for (const file of filesToProcess) {
            if (!(file instanceof File) || file.size === 0) {
                processedFileResults.push({
                    success: false,
                    fileName: file.name || 'unknown_file',
                    message: '文件为空或无效',
                });
                allSuccess = false;
                continue;
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
                processedFileResults.push({
                    success: false,
                    fileName: file.name,
                    message: `文件大小超过限制 (${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`,
                });
                allSuccess = false;
                continue;
            }

            if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                processedFileResults.push({
                    success: false,
                    fileName: file.name,
                    message: `无效的文件类型: ${file.type}. 允许的类型: ${ALLOWED_MIME_TYPES.join(', ')}`,
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

                // uploadDirectory is already sanitized
                if (uploadDirectory) {
                    r2ObjectKey = `${uploadDirectory}/${imageId}${fileExtension}`;
                }

                await IMGBED_R2.put(r2ObjectKey, fileBuffer, {
                    httpMetadata: { contentType: file.type }, // Use validated file.type
                });

                const metadata = {
                    id: imageId,
                    r2Key: r2ObjectKey,
                    fileName: file.name, // Original filename for display/metadata
                    contentType: file.type, // Validated content type
                    size: file.size,
                    uploadedAt: new Date().toISOString(),
                    userId: apiKeyDetails.userId,
                    uploadPath: uploadDirectory || undefined, // Store sanitized path
                };

                await IMGBED_KV.put(
                    `image:${imageId}`,
                    JSON.stringify(metadata),
                );

                let baseUrl =
                    (await IMGBED_KV.get('config:siteDomain'))?.trim() ||
                    new URL(request.url).origin;
                if (
                    baseUrl &&
                    !baseUrl.startsWith('http://') &&
                    !baseUrl.startsWith('https://')
                )
                    baseUrl = 'https://' + baseUrl;
                baseUrl = baseUrl.replace(/\/$/, '');

                const imageAccessPrefix =
                    (await IMGBED_KV.get('config:customImagePrefix')) || 'img';
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
                console.error(`上传文件失败 ${file.name}:`, e);
                processedFileResults.push({
                    success: false,
                    fileName: file.name,
                    message: e.message || '未知错误',
                });
                allSuccess = false;
            }
        }

        // 构建最终响应
        const successfulUploads = processedFileResults.filter((r) => r.success);

        if (!someSuccess) {
            // 所有文件都上传失败
            return new Response(
                JSON.stringify({
                    success: false,
                    message: '所有文件上传失败',
                    results: processedFileResults,
                }),
                {
                    status: 500, // 或者 400，取决于具体场景
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        // 部分或全部成功
        return new Response(
            JSON.stringify({
                success: allSuccess, // 如果有任何失败，则为 false
                message: allSuccess
                    ? `成功上传 ${successfulUploads.length} 个文件`
                    : `部分文件上传成功 (${successfulUploads.length}/${filesToProcess.length})`,
                data: successfulUploads.map((r) => r.data), // 仅包含成功上传的数据
                results: processedFileResults, // 包含所有文件的处理结果
            }),
            {
                status: 200, // 即使部分失败，主状态码仍为 200，详细信息在 body 中
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error: any) {
        console.error('API上传处理错误:', error);
        return new Response(
            JSON.stringify({
                success: false,
                message: `服务器错误: ${error.message || '未知错误'}`,
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
};
