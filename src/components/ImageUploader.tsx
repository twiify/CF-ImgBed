import { Fragment } from 'preact';
import {
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
} from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { actions } from 'astro:actions';
import { escapeHtml } from '~/lib/utils';
import Cropper from 'cropperjs';

// Define UploadedFileResponse interface (copied from original script)
interface UploadedFileResponse {
    id: string;
    r2Key: string;
    fileName: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    userId?: string;
    uploadPath?: string;
    url: string;
}

// Type for the upload result, adapted for useState
type UploadResultState = {
    success: boolean;
    message: string;
    results: Array<{
        success: boolean;
        fileName: string;
        data?: UploadedFileResponse;
        message?: string;
        conversionStatus?: 'converted' | 'failed' | 'skipped'; // For WebP conversion
        contentHash?: string;
    }>;
    error?: boolean; // UI-specific error flag
} | null;

interface AppSettings {
    defaultCopyFormat?: string;
    customImagePrefix?: string;
    enableHotlinkProtection?: boolean;
    allowedDomains?: string[];
    siteDomain?: string;
    convertToWebP?: boolean;
}

interface FileWithHash extends File {
    contentHash?: string;
}

export default function ImageUploader() {
    const [currentFiles, setCurrentFiles] = useState<FileWithHash[]>([]);
    const [uploadDirectory, setUploadDirectory] = useState<string>('');
    const [uploading, setUploading] = useState<boolean>(false);
    const [uploadResult, setUploadResult] = useState<UploadResultState>(null);
    const [pastedImagePreviews, setPastedImagePreviews] = useState<
        Array<{ file: File; url: string }>
    >([]);
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [showPreviewModal, setShowPreviewModal] = useState<{
        file: File;
        url: string;
        cropperInstance?: Cropper;
        cropperImageElement?: any;
        cropperSelectionElement?: any;
    } | null>(null);
    const imagePreviewRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        // Fetch app settings when component mounts
        const fetchAppSettings = async () => {
            try {
                const result = await actions.admin.getAppSettings({});
                if (result.data) {
                    setAppSettings(result.data);
                } else if (result.error) {
                    console.error(
                        'Failed to fetch app settings:',
                        result.error.message,
                    );
                    // Initialize with default if fetch fails, so WebP conversion defaults to off
                    setAppSettings({ convertToWebP: false });
                }
            } catch (error) {
                console.error('Error fetching app settings:', error);
                setAppSettings({ convertToWebP: false });
            }
        };
        fetchAppSettings();
    }, []);

    const getFileContentHash = async (file: File): Promise<string> => {
        try {
            const buffer = await file.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
            return hashHex;
        } catch (error) {
            console.error('Error getting file content hash:', error);
            return `error-${file.name}-${file.size}-${Date.now()}`;
        }
    };

    // Helper function to add new files, ensuring no duplicates
    const addFilesToState = useCallback((newFilesArray: FileWithHash[]) => {
        if (newFilesArray.length === 0) return;

        setCurrentFiles((prevFiles) => {
            const imageFiles = newFilesArray.filter((file) =>
                file.type.startsWith('image/'),
            );
            const trulyNewFiles = imageFiles.filter((newFile) => {
                if (newFile.contentHash) {
                    const isContentDuplicate = prevFiles.some(
                        (existingFileInState) =>
                            existingFileInState.contentHash &&
                            existingFileInState.contentHash ===
                                newFile.contentHash,
                    );
                    if (isContentDuplicate) {
                        console.log(
                            `Skipping duplicate file(contentHash): ${newFile.name}`,
                        );
                        return false;
                    }
                }

                const isMetadataDuplicate = prevFiles.some(
                    (existingFile) =>
                        existingFile.name === newFile.name &&
                        existingFile.size === newFile.size &&
                        existingFile.lastModified === newFile.lastModified,
                );
                if (isMetadataDuplicate) {
                    console.log(
                        `Skipping duplicate file(metadata): ${newFile.name}`,
                    );
                    return false;
                }
                return true;
            });
            return [...prevFiles, ...trulyNewFiles];
        });
    }, []);

    // Effect for managing pasted image previews and their object URLs
    useEffect(() => {
        const newPreviews = currentFiles.map((file) => ({
            file,
            url: URL.createObjectURL(file),
        }));
        setPastedImagePreviews(newPreviews);

        return () => {
            newPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
        };
    }, [currentFiles]);

    const selectedFileNamesText = useMemo(() => {
        if (currentFiles.length > 0) {
            // 对于移动端，使用更友好的显示方式
            const fileNames = currentFiles.map((file) => escapeHtml(file.name));

            if (fileNames.length === 1) {
                // 单个文件时直接显示
                return `<strong>已选择 (1):</strong> ${fileNames[0]}`;
            } else if (fileNames.length <= 3) {
                // 少量文件时每个文件名占一行
                const fileList = fileNames
                    .map((name) => `<span class="block">${name}</span>`)
                    .join('');
                return `<strong>已选择 (${currentFiles.length}):</strong><br/>${fileList}`;
            } else {
                // 多个文件时显示前3个，然后省略
                const firstThree = fileNames.slice(0, 3);
                const fileList = firstThree
                    .map((name) => `<span class="block">${name}</span>`)
                    .join('');
                return `<strong>已选择 (${currentFiles.length}):</strong><br/>${fileList}<span class="block text-text-secondary">...以及其他 ${currentFiles.length - 3} 个文件</span>`;
            }
        }
        return '';
    }, [currentFiles]);

    const handleFileDrop = useCallback(
        (event: DragEvent) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement)?.classList.remove(
                'scale-105',
                'border-primary',
                'bg-primary/10',
            );
            if (
                event.dataTransfer?.files &&
                event.dataTransfer.files.length > 0
            ) {
                addFilesToState(Array.from(event.dataTransfer.files));
            }
        },
        [addFilesToState],
    );

    const handleFileInputChange = useCallback(
        (event: Event) => {
            const input = event.target as HTMLInputElement;
            if (input.files && input.files.length > 0) {
                addFilesToState(Array.from(input.files));
                input.value = '';
            }
        },
        [addFilesToState],
    );

    const handlePaste = useCallback(
        async (event: ClipboardEvent) => {
            if (!event.clipboardData) return;
            event.preventDefault();

            let processedAnyContent = false;
            const newFilesBatch: FileWithHash[] = [];

            if (event.clipboardData.items) {
                const items = Array.from(event.clipboardData.items);
                for (const item of items) {
                    if (
                        item.kind === 'file' &&
                        item.type.startsWith('image/')
                    ) {
                        const rawPastedFile = item.getAsFile();
                        if (rawPastedFile) {
                            let fileToProcess: File;
                            const originalName = rawPastedFile.name;
                            // Regex for generic image names or names without extensions
                            const genericImageNameRegex =
                                /^(image|screenshot|capture|pasted image|img|pic)\d*\.(jpe?g|png|gif|webp|svg)$/i;
                            const hasNoExtension = !originalName.includes('.');

                            if (
                                genericImageNameRegex.test(originalName) ||
                                (originalName &&
                                    hasNoExtension &&
                                    rawPastedFile.type.startsWith('image/'))
                            ) {
                                const timestamp = new Date()
                                    .toISOString()
                                    .replace(/[:.]/g, '-');
                                // Ensure extension is reasonably extracted, e.g. 'svg+xml' becomes 'svg'
                                const extension = (
                                    rawPastedFile.type.split('/')[1] || 'png'
                                ).split('+')[0];
                                const newFileName = `clipboard-image-${timestamp}.${extension}`;
                                fileToProcess = new File(
                                    [rawPastedFile],
                                    newFileName,
                                    {
                                        type: rawPastedFile.type,
                                        lastModified:
                                            rawPastedFile.lastModified,
                                    },
                                );
                                console.log(
                                    `Pasted image renamed from "${originalName}" to "${newFileName}"`,
                                );
                            } else {
                                fileToProcess = rawPastedFile;
                            }
                            const hash =
                                await getFileContentHash(fileToProcess);
                            newFilesBatch.push(
                                Object.assign(fileToProcess, {
                                    contentHash: hash,
                                }),
                            );
                        }
                        processedAnyContent = true;
                    } else if (
                        item.kind === 'string' &&
                        item.type === 'text/plain'
                    ) {
                        const text = await new Promise<string>((resolve) =>
                            item.getAsString(resolve),
                        );
                        if (
                            text.match(
                                /^https?:\/\/.*\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i,
                            )
                        ) {
                            try {
                                const response = await fetch(text, {
                                    mode: 'cors',
                                });
                                if (!response.ok) continue;
                                const blob = await response.blob();
                                if (blob.type.startsWith('image/')) {
                                    const urlParts = text.split('/');
                                    const originalFileName =
                                        urlParts[urlParts.length - 1].split(
                                            '?',
                                        )[0];
                                    let fileName = originalFileName;

                                    if (
                                        !fileName ||
                                        /^image\.(jpe?g|png|gif|webp|svg)$/i.test(
                                            fileName,
                                        )
                                    ) {
                                        const timestamp = new Date()
                                            .toISOString()
                                            .replace(/[:.]/g, '-');
                                        const extension = (
                                            blob.type.split('/')[1] || 'bin'
                                        ).split('+')[0];
                                        fileName = `pasted-url-${timestamp}.${extension}`;
                                    }

                                    const file = new File([blob], fileName, {
                                        type: blob.type,
                                    });
                                    const hash = await getFileContentHash(file);
                                    newFilesBatch.push(
                                        Object.assign(file, {
                                            contentHash: hash,
                                        }),
                                    );
                                    processedAnyContent = true;
                                }
                            } catch (e) {
                                console.error('从URL获取图片失败:', e);
                            }
                        }
                    }
                }
            }

            if (!processedAnyContent && event.clipboardData.items) {
                for (const item of event.clipboardData.items) {
                    if (item.type.startsWith('image/')) {
                        const blob = item.getAsFile();
                        if (blob) {
                            const timestamp = new Date()
                                .toISOString()
                                .replace(/[:.]/g, '-');
                            const extension = (
                                blob.type.split('/')[1] || 'png'
                            ).split('+')[0];
                            const fileName = `clipboard-image-${timestamp}.${extension}`;
                            const file = new File([blob], fileName, {
                                type: blob.type,
                                lastModified:
                                    blob instanceof File
                                        ? blob.lastModified
                                        : Date.now(),
                            });
                            const hash = await getFileContentHash(file);
                            newFilesBatch.push(
                                Object.assign(file, { contentHash: hash }),
                            );
                            processedAnyContent = true;
                        }
                    }
                }
            }

            if (
                !processedAnyContent &&
                event.clipboardData.getData('text/html')
            ) {
                const html = event.clipboardData.getData('text/html');
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                const images = tempDiv.querySelectorAll('img');
                for (const img of images) {
                    if (img.src.startsWith('data:image/')) {
                        try {
                            const response = await fetch(img.src);
                            if (!response.ok) continue;
                            const blob = await response.blob();
                            const timestamp = new Date()
                                .toISOString()
                                .replace(/[:.]/g, '-');
                            const extension = blob.type.split('/')[1] || 'png';
                            const fileName = `embedded-image-${timestamp}.${extension}`;
                            const file = new File([blob], fileName, {
                                type: blob.type,
                            });
                            const hash = await getFileContentHash(file);
                            newFilesBatch.push(
                                Object.assign(file, { contentHash: hash }),
                            );
                        } catch (e) {
                            console.error('处理嵌入图片失败:', e);
                        }
                    }
                }
            }

            if (newFilesBatch.length > 0) {
                addFilesToState(newFilesBatch);
            }
        },
        [addFilesToState],
    );

    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => {
            document.removeEventListener('paste', handlePaste);
        };
    }, [handlePaste]);

    const removeFile = useCallback((indexToRemove: number) => {
        setCurrentFiles((prevFiles) =>
            prevFiles.filter((_, index) => index !== indexToRemove),
        );
    }, []);

    const handleUpload = async () => {
        if (currentFiles.length === 0) {
            setUploadResult({
                success: false,
                message: '请选择要上传的文件。',
                results: [],
                error: true,
            });
            return;
        }

        setUploading(true);
        setUploadResult(null);

        const filesToUpload: File[] = [];
        const conversionResults: Array<{
            originalName: string;
            newName?: string;
            status: 'converted' | 'failed' | 'skipped';
        }> = [];

        const shouldConvertToWebP = appSettings?.convertToWebP || false;

        for (const file of currentFiles) {
            if (
                shouldConvertToWebP &&
                file.type.startsWith('image/') &&
                file.type !== 'image/webp' &&
                file.type !== 'image/svg+xml'
            ) {
                try {
                    const image = new Image();
                    const reader = new FileReader();

                    const conversionPromise = new Promise<{
                        success: boolean;
                        file: File;
                        originalName: string;
                        newName?: string;
                    }>((resolve, reject) => {
                        reader.onload = (e) => {
                            image.onload = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = image.naturalWidth;
                                canvas.height = image.naturalHeight;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) {
                                    reject(
                                        new Error(
                                            'Failed to get canvas context.',
                                        ),
                                    );
                                    return;
                                }
                                ctx.drawImage(image, 0, 0);
                                canvas.toBlob(
                                    (blob) => {
                                        if (blob) {
                                            const newFileName =
                                                file.name.substring(
                                                    0,
                                                    file.name.lastIndexOf('.'),
                                                ) + '.webp';
                                            resolve({
                                                success: true,
                                                file: new File(
                                                    [blob],
                                                    newFileName,
                                                    { type: 'image/webp' },
                                                ),
                                                originalName: file.name,
                                                newName: newFileName,
                                            });
                                        } else {
                                            resolve({
                                                success: false,
                                                file: file,
                                                originalName: file.name,
                                            }); // Conversion failed, use original
                                        }
                                    },
                                    'image/webp',
                                    0.8,
                                ); // 0.8 quality
                            };
                            image.onerror = () =>
                                resolve({
                                    success: false,
                                    file: file,
                                    originalName: file.name,
                                }); // Image load error
                            if (e.target?.result) {
                                image.src = e.target.result as string;
                            } else {
                                resolve({
                                    success: false,
                                    file: file,
                                    originalName: file.name,
                                }); // FileReader error
                            }
                        };
                        reader.onerror = () =>
                            resolve({
                                success: false,
                                file: file,
                                originalName: file.name,
                            }); // FileReader error
                        reader.readAsDataURL(file);
                    });

                    const result = await conversionPromise;
                    filesToUpload.push(result.file);
                    conversionResults.push({
                        originalName: result.originalName,
                        newName: result.newName,
                        status: result.success ? 'converted' : 'failed',
                    });
                } catch (error) {
                    console.error(
                        `Error converting ${file.name} to WebP:`,
                        error,
                    );
                    filesToUpload.push(file); // Use original on error
                    conversionResults.push({
                        originalName: file.name,
                        status: 'failed',
                    });
                }
            } else {
                filesToUpload.push(file);
                conversionResults.push({
                    originalName: file.name,
                    status: 'skipped',
                });
            }
        }

        const formData = new FormData();
        filesToUpload.forEach((file) => formData.append('files', file));

        const uploadDir = uploadDirectory.trim();
        if (uploadDir) {
            formData.append('uploadDirectory', uploadDir);
        }

        try {
            const actionResponse = await actions.image.upload(formData);

            if (actionResponse.error) {
                let errorMessage = actionResponse.error.message;
                if (
                    actionResponse.error.code === 'BAD_REQUEST' &&
                    (actionResponse.error as any).fields
                ) {
                    const fieldErrors = Object.values(
                        (actionResponse.error as any).fields,
                    )
                        .flat()
                        .join(', ');
                    errorMessage = fieldErrors || actionResponse.error.message;
                }
                setUploadResult({
                    success: false,
                    message: `上传失败: ${errorMessage}`,
                    results: filesToUpload.map((f) => {
                        const convRes = conversionResults.find(
                            (cr) => (cr.newName || cr.originalName) === f.name,
                        );
                        return {
                            success: false,
                            fileName: f.name,
                            message: '上传失败',
                            conversionStatus: convRes?.status,
                        };
                    }),
                    error: true,
                });
            } else if (actionResponse.data) {
                // Ensure backendResult and its critical properties are not null/undefined before proceeding
                const rawBackendResult =
                    actionResponse.data as Partial<UploadResultState>; // Use Partial to handle potentially missing fields safely

                if (
                    rawBackendResult &&
                    typeof rawBackendResult.success === 'boolean' &&
                    Array.isArray(rawBackendResult.results)
                ) {
                    const backendResult: UploadResultState = {
                        // Explicitly cast to UploadResultState after checks
                        success: rawBackendResult.success,
                        message:
                            rawBackendResult.message ||
                            (rawBackendResult.success
                                ? '上传操作已处理。'
                                : '上传操作部分失败或包含错误。'),
                        results: rawBackendResult.results.map((r) => ({
                            success: !!r.success, // Ensure boolean
                            fileName: r.fileName || '未知文件',
                            data: r.data,
                            message: r.message,
                            conversionStatus: r.conversionStatus, // This will be updated next
                        })),
                        error: !rawBackendResult.success, // Add error field based on success
                    };

                    // Merge conversion status with backend results
                    const finalResults = backendResult.results.map((br) => {
                        const convRes = conversionResults.find(
                            (cr) =>
                                (cr.newName || cr.originalName) === br.fileName,
                        );
                        return {
                            ...br,
                            conversionStatus:
                                convRes?.status ||
                                br.conversionStatus ||
                                'skipped',
                        };
                    });

                    setUploadResult({
                        ...backendResult,
                        results: finalResults,
                    }); // error is already part of backendResult

                    if (backendResult.success) {
                        setCurrentFiles([]);
                    } else {
                        const successfullyUploadedAndProcessedFileNames =
                            finalResults
                                .filter((r) => r.success && r.data)
                                .map((r) => r.fileName);

                        const originalNamesOfSuccessfullyUploaded =
                            successfullyUploadedAndProcessedFileNames.map(
                                (uploadedName) => {
                                    const convRes = conversionResults.find(
                                        (cr) => cr.newName === uploadedName,
                                    );
                                    return convRes
                                        ? convRes.originalName
                                        : uploadedName;
                                },
                            );

                        setCurrentFiles((prevFiles) =>
                            prevFiles.filter(
                                (originalFile) =>
                                    !originalNamesOfSuccessfullyUploaded.includes(
                                        originalFile.name,
                                    ),
                            ),
                        );
                    }
                } else {
                    // rawBackendResult is not as expected
                    setUploadResult({
                        success: false,
                        message: '上传响应格式不正确或不完整。',
                        results: [],
                        error: true,
                    });
                }
            } else {
                // actionResponse.data is null/undefined
                setUploadResult({
                    success: false,
                    message: '上传响应格式错误 (无数据)。',
                    results: [],
                    error: true,
                });
            }
        } catch (error: any) {
            console.error('Upload error:', error.message);
            setUploadResult({
                success: false,
                message: `上传失败: ${error.message || '未知网络错误'}`,
                results: filesToUpload.map((f) => {
                    const convRes = conversionResults.find(
                        (cr) => (cr.newName || cr.originalName) === f.name,
                    );
                    return {
                        success: false,
                        fileName: f.name,
                        message: '上传失败',
                        conversionStatus: convRes?.status,
                    };
                }),
                error: true,
            });
        } finally {
            setUploading(false);
        }
    };

    const openPreviewModal = (file: File, _url: string) => {
        const modalUrl = URL.createObjectURL(file);

        // 保存当前滚动位置
        const scrollY = window.scrollY;

        // 禁用页面滚动并固定到当前位置
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';

        // 存储滚动位置供关闭时恢复
        document.body.setAttribute('data-scroll-y', scrollY.toString());

        setShowPreviewModal({
            file,
            url: modalUrl,
            cropperInstance: undefined,
        });
    };

    const closePreviewModal = () => {
        if (showPreviewModal) {
            URL.revokeObjectURL(showPreviewModal.url);

            // 恢复页面滚动和位置
            const scrollY = document.body.getAttribute('data-scroll-y');
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';

            // 恢复到保存的滚动位置
            if (scrollY) {
                window.scrollTo(0, parseInt(scrollY));
                document.body.removeAttribute('data-scroll-y');
            }

            setShowPreviewModal(null);
        }
    };

    useEffect(() => {
        if (
            showPreviewModal &&
            imagePreviewRef.current &&
            !showPreviewModal.cropperInstance
        ) {
            // Define a template that enables the features we need for Cropper.js v2
            const template = `
        <cropper-canvas background>
          <cropper-image rotatable scalable translatable></cropper-image>
          <cropper-shade hidden></cropper-shade>
          <cropper-handle action="select" plain></cropper-handle>
          <cropper-selection initial-coverage="0.5" movable resizable outlined aspect-ratio="NaN">
            <cropper-grid role="grid" bordered covered></cropper-grid>
            <cropper-crosshair centered></cropper-crosshair>
            <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>
            <cropper-handle action="n-resize"></cropper-handle>
            <cropper-handle action="e-resize"></cropper-handle>
            <cropper-handle action="s-resize"></cropper-handle>
            <cropper-handle action="w-resize"></cropper-handle>
            <cropper-handle action="ne-resize"></cropper-handle>
            <cropper-handle action="nw-resize"></cropper-handle>
            <cropper-handle action="se-resize"></cropper-handle>
            <cropper-handle action="sw-resize"></cropper-handle>
          </cropper-selection>
        </cropper-canvas>
      `;
            // Initialize Cropper for v2 with the custom template.
            const newCropper = new Cropper(imagePreviewRef.current, {
                template,
                container: '.cropper-container',
            });

            // Ensure the cropper canvas fills the available height
            const cropperHostElement = newCropper.container as HTMLElement;
            const cropperCanvasEl = cropperHostElement.querySelector(
                'cropper-canvas',
            ) as HTMLElement | null;

            const updateDimensions = () => {
                if (cropperHostElement && cropperCanvasEl) {
                    const hostHeight = cropperHostElement.offsetHeight;
                    if (hostHeight > 0) {
                        cropperCanvasEl.style.height = `${hostHeight}px`;
                    }
                    cropperCanvasEl.style.width = '100%';
                }
            };

            // 等待图片加载完成后再调整尺寸和居中
            const imageElement = imagePreviewRef.current;
            if (imageElement) {
                const handleImageLoad = () => {
                    requestAnimationFrame(() => {
                        updateDimensions();
                        // 自动居中并适配图片
                        newCropper.getCropperImage()?.$center?.('contain');
                        // 重置选择区域到初始状态
                        newCropper.getCropperSelection()?.$reset?.();
                    });
                };

                if (imageElement.complete) {
                    // 图片已经加载完成
                    handleImageLoad();
                } else {
                    // 等待图片加载
                    imageElement.addEventListener('load', handleImageLoad, {
                        once: true,
                    });
                }
            } else {
                requestAnimationFrame(() => {
                    updateDimensions();
                });
            }

            setShowPreviewModal((prevModalState) => {
                if (
                    prevModalState &&
                    prevModalState.url === showPreviewModal.url
                ) {
                    return {
                        ...prevModalState,
                        cropperInstance: newCropper,
                        cropperImageElement: newCropper.getCropperImage(),
                        cropperSelectionElement:
                            newCropper.getCropperSelection(),
                    };
                }
                return prevModalState;
            });
        }
    }, [showPreviewModal]);

    // ESC键关闭模态框
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && showPreviewModal) {
                closePreviewModal();
            }
        };

        if (showPreviewModal) {
            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
            };
        }
    }, [showPreviewModal]);

    // 组件卸载时清理滚动锁定
    useEffect(() => {
        return () => {
            // 组件卸载时确保恢复滚动
            const scrollY = document.body.getAttribute('data-scroll-y');
            if (scrollY) {
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.width = '';
                document.body.style.overflow = '';
                window.scrollTo(0, parseInt(scrollY));
                document.body.removeAttribute('data-scroll-y');
            }
        };
    }, []);

    // JSX for the component
    return (
        <Fragment>
            <div className="flex justify-center w-full py-8">
                <div className="w-full max-w-2xl lg:max-w-4xl shadow-xl rounded-2xl upload-section card bg-base-100">
                    <div className="card-body p-8 space-y-6">
                        {/* Image Dropzone and Preview */}
                        <div className="space-y-6">
                            <div
                                id="drop-zone"
                                className="w-full cursor-pointer text-center flex flex-col items-center justify-center group relative overflow-hidden bg-gradient-to-br from-surface to-surface-variant border-2 border-dashed border-border rounded-[20px] transition-all duration-300 ease-out hover:border-primary hover:-translate-y-1 hover:shadow-lg hover:bg-primary/5"
                                style={{
                                    padding: '3rem 2rem',
                                    minHeight: '200px',
                                    height: 'auto',
                                }}
                                onClick={() =>
                                    (
                                        document.getElementById(
                                            'file-input',
                                        ) as HTMLInputElement
                                    )?.click()
                                }
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.add(
                                        'scale-105',
                                        'border-primary',
                                        'bg-primary/10',
                                    );
                                }}
                                onDragLeave={(e) =>
                                    e.currentTarget.classList.remove(
                                        'scale-105',
                                        'border-primary',
                                        'bg-primary/10',
                                    )
                                }
                                onDrop={handleFileDrop}
                            >
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                                        <span className="material-symbols-outlined text-3xl text-primary">
                                            cloud_upload
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-semibold text-text mb-2">
                                        拖拽上传图片
                                    </h3>
                                    <p className="text-text-secondary mb-4 max-w-md">
                                        拖拽文件到此处，点击选择文件，或使用
                                        Ctrl+V 粘贴图片
                                    </p>
                                    <div className="flex items-center gap-6 text-sm text-text-muted">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">
                                                image
                                            </span>
                                            <span>支持多种格式</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">
                                                layers
                                            </span>
                                            <span>批量上传</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">
                                                edit
                                            </span>
                                            <span>实时编辑</span>
                                        </div>
                                    </div>
                                </div>
                                <input
                                    type="file"
                                    id="file-input"
                                    multiple
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileInputChange}
                                />
                            </div>

                            {/* 已选择文件显示区域 - 移出拖拽区域 */}
                            {selectedFileNamesText && (
                                <div
                                    className="p-4 bg-primary/5 rounded-xl border border-primary/20 text-sm text-text-secondary break-words overflow-wrap-anywhere"
                                    dangerouslySetInnerHTML={{
                                        __html: selectedFileNamesText,
                                    }}
                                ></div>
                            )}

                            {pastedImagePreviews.length > 0 && (
                                <div className="card-enhanced p-6 bg-gradient-subtle border-primary/10">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                                            <span className="material-symbols-outlined text-primary text-lg">
                                                photo_library
                                            </span>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-text text-lg">
                                                已选择的图片
                                            </h4>
                                            <p className="text-sm text-text-secondary">
                                                共 {pastedImagePreviews.length}{' '}
                                                个文件
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                        {pastedImagePreviews.map(
                                            (preview, index) => (
                                                <div
                                                    key={`${preview.file.name}-${preview.file.lastModified}`}
                                                    className="relative aspect-square cursor-pointer overflow-hidden rounded-2xl bg-surface border border-border-light hover:border-primary/50 hover:shadow-lg transition-all duration-300 group"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openPreviewModal(
                                                            preview.file,
                                                            preview.url,
                                                        );
                                                    }}
                                                >
                                                    <img
                                                        src={preview.url}
                                                        alt={`预览 ${escapeHtml(preview.file.name)}`}
                                                        className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-300"
                                                    />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                                                        <span className="material-symbols-outlined text-white text-2xl">
                                                            edit
                                                        </span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="absolute top-2 right-2 w-6 h-6 bg-error hover:bg-error/80 text-white rounded-full flex items-center justify-center hover:scale-110 transition-all duration-200 shadow-md"
                                                        title={`移除 ${escapeHtml(preview.file.name)}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeFile(index);
                                                        }}
                                                    >
                                                        <span className="material-symbols-outlined text-sm">
                                                            close
                                                        </span>
                                                    </button>
                                                </div>
                                            ),
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Upload Directory Input */}
                        <div className="space-y-3">
                            <label
                                htmlFor="upload-directory"
                                className="flex items-center gap-2 text-sm font-medium text-text"
                            >
                                <span className="material-symbols-outlined text-base">
                                    folder
                                </span>
                                指定上传目录 (可选)
                            </label>
                            <input
                                type="text"
                                id="upload-directory"
                                name="upload-directory"
                                placeholder="例如：wallpapers/nature"
                                className="input-enhanced w-full"
                                value={uploadDirectory}
                                onInput={(e) =>
                                    setUploadDirectory(
                                        (e.target as HTMLInputElement).value,
                                    )
                                }
                            />
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">
                                    info
                                </span>
                                留空将上传到根目录，使用斜杠分隔多级目录
                            </p>
                        </div>

                        {/* Upload Button */}
                        <button
                            id="upload-button"
                            className="btn-enhanced btn-primary-enhanced py-4 px-8 text-base font-medium self-center rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 min-w-48"
                            onClick={handleUpload}
                            disabled={uploading || currentFiles.length === 0}
                        >
                            {uploading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                    <span>
                                        正在上传 {currentFiles.length} 个文件...
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="material-symbols-outlined">
                                        cloud_upload
                                    </span>
                                    <span>
                                        开始上传
                                        {currentFiles.length > 0
                                            ? ` (${currentFiles.length})`
                                            : ''}
                                    </span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {uploadResult && (
                <div className="card p-6 shadow-xl links-section md:p-8">
                    <h2
                        class={`text-2xl font-semibold mb-4 ${uploadResult.error ? 'text-red-500' : uploadResult.success ? 'text-green-600' : 'text-yellow-600'}`}
                    >
                        {uploadResult.error
                            ? '上传出错'
                            : uploadResult.success
                              ? '上传成功！'
                              : '部分上传成功'}
                    </h2>
                    <div id="uploaded-links" className="space-y-4">
                        <p
                            className={`mb-4 ${uploadResult.error ? 'text-red-500' : uploadResult.success ? 'text-green-600' : 'text-yellow-600'}`}
                        >
                            {escapeHtml(uploadResult.message)}
                        </p>
                        {uploadResult.results.map((fileResult, index) => (
                            <div
                                key={`${fileResult.fileName}-${index}`}
                                className={`p-4 border rounded-md mb-2 ${fileResult.success ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}
                            >
                                <p className="mb-1 break-all font-medium">
                                    {`${escapeHtml(fileResult.fileName)}: ${fileResult.success ? '成功' : '失败'}`}
                                    {fileResult.conversionStatus ===
                                        'failed' && (
                                        <span className="ml-2 text-xs text-orange-500">
                                            (WebP转换失败)
                                        </span>
                                    )}
                                    {fileResult.conversionStatus ===
                                        'converted' && (
                                        <span className="ml-2 text-xs text-green-500">
                                            (已转为WebP)
                                        </span>
                                    )}
                                </p>
                                {fileResult.success && fileResult.data && (
                                    <div className="mt-1 space-y-1">
                                        {['url', 'markdown', 'html'].map(
                                            (formatKey) => {
                                                const uploadedFile =
                                                    fileResult.data!;
                                                let value = '';
                                                let label = '';
                                                switch (formatKey) {
                                                    case 'url':
                                                        value =
                                                            uploadedFile.url;
                                                        label = 'URL';
                                                        break;
                                                    case 'markdown':
                                                        value = `![${escapeHtml(uploadedFile.fileName)}](${uploadedFile.url})`;
                                                        label = 'Markdown';
                                                        break;
                                                    case 'html':
                                                        value = `<img src="${uploadedFile.url}" alt="${escapeHtml(uploadedFile.fileName)}" />`;
                                                        label = 'HTML';
                                                        break;
                                                }

                                                const copyToClipboard = (
                                                    textToCopy: string,
                                                    feedbackId: string,
                                                ) => {
                                                    navigator.clipboard
                                                        .writeText(textToCopy)
                                                        .then(() => {
                                                            const feedbackEl =
                                                                document.getElementById(
                                                                    feedbackId,
                                                                );
                                                            if (feedbackEl) {
                                                                feedbackEl.classList.remove(
                                                                    'hidden',
                                                                );
                                                                setTimeout(
                                                                    () =>
                                                                        feedbackEl.classList.add(
                                                                            'hidden',
                                                                        ),
                                                                    1500,
                                                                );
                                                            }
                                                            // Auto-copy logic based on localStorage (simplified for brevity)
                                                            if (
                                                                formatKey.toLowerCase() ===
                                                                (
                                                                    localStorage.getItem(
                                                                        'defaultCopyFormat',
                                                                    ) || 'url'
                                                                ).toLowerCase()
                                                            ) {
                                                                // This part of auto-copying on initial display might need more nuanced handling
                                                                // if multiple files are uploaded, as it would try to auto-copy for each.
                                                                // For now, the click-to-copy is primary.
                                                            }
                                                        })
                                                        .catch((err) => {
                                                            console.error(
                                                                `Could not copy ${label}: `,
                                                                err,
                                                            );
                                                            const feedbackEl =
                                                                document.getElementById(
                                                                    feedbackId,
                                                                );
                                                            if (feedbackEl) {
                                                                feedbackEl.textContent =
                                                                    '复制失败';
                                                                feedbackEl.className =
                                                                    'ml-2 text-xs text-red-500';
                                                                feedbackEl.classList.remove(
                                                                    'hidden',
                                                                );
                                                                setTimeout(
                                                                    () => {
                                                                        feedbackEl.classList.add(
                                                                            'hidden',
                                                                        );
                                                                        feedbackEl.textContent =
                                                                            '已复制!';
                                                                        feedbackEl.className =
                                                                            'ml-2 hidden text-xs text-green-500';
                                                                    },
                                                                    2000,
                                                                );
                                                            }
                                                        });
                                                };
                                                const inputId = `link-${fileResult.fileName}-${formatKey}-${index}`;
                                                const feedbackId = `feedback-${fileResult.fileName}-${formatKey}-${index}`;

                                                return (
                                                    <div key={formatKey}>
                                                        <span className="text-xs font-semibold">
                                                            {label}:{' '}
                                                        </span>
                                                        <input
                                                            id={inputId}
                                                            type="text"
                                                            readOnly
                                                            value={value}
                                                            className="w-full rounded-md input"
                                                            onFocus={(e) =>
                                                                (
                                                                    e.target as HTMLInputElement
                                                                ).select()
                                                            }
                                                            onClick={() =>
                                                                copyToClipboard(
                                                                    value,
                                                                    feedbackId,
                                                                )
                                                            }
                                                        />
                                                        <span
                                                            id={feedbackId}
                                                            className="ml-2 hidden text-xs text-green-500"
                                                        >
                                                            已复制!
                                                        </span>
                                                    </div>
                                                );
                                            },
                                        )}
                                    </div>
                                )}
                                {!fileResult.success && fileResult.message && (
                                    <p className="text-sm text-red-600">
                                        原因: {escapeHtml(fileResult.message)}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 模态框使用Portal渲染到body层级 */}
            {showPreviewModal &&
                createPortal(
                    <div
                        id="image-preview-modal"
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 9999,
                            margin: 0,
                            padding: '1rem',
                        }}
                        onClick={closePreviewModal}
                    >
                        {/* Modal content container to prevent close on click */}
                        <div
                            className="card-enhanced flex w-full flex-col max-w-[95vw] max-h-[95vh] md:max-w-4xl lg:max-w-6xl animate-scale-in m-auto overflow-y-auto"
                            style={{
                                maxWidth: 'min(95vw, 1200px)',
                                maxHeight: 'min(95vh, 800px)',
                                margin: 'auto',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between p-4 sm:p-6 pb-4 border-b border-border-light flex-shrink-0">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                        <span className="material-symbols-outlined text-primary text-lg">
                                            edit
                                        </span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-lg sm:text-xl font-bold text-text">
                                            图片编辑
                                        </h3>
                                        <p className="text-xs sm:text-sm text-text-secondary truncate">
                                            {escapeHtml(
                                                showPreviewModal.file.name,
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    className="w-10 h-10 rounded-xl bg-surface hover:bg-error/10 border border-border-light hover:border-error/20 flex items-center justify-center transition-all duration-200 group flex-shrink-0"
                                    onClick={closePreviewModal}
                                    title="关闭编辑器"
                                >
                                    <span className="material-symbols-outlined text-text-secondary group-hover:text-error text-lg">
                                        close
                                    </span>
                                </button>
                            </div>

                            {/* Cropper Container */}
                            <div className="cropper-container flex-1 min-h-[300px] sm:min-h-[400px] relative rounded-2xl overflow-hidden bg-surface border border-border-light mx-4 sm:mx-6 my-4">
                                <img
                                    ref={imagePreviewRef}
                                    src={showPreviewModal.url}
                                    alt={`编辑 ${escapeHtml(showPreviewModal.file.name)}`}
                                    className="block h-full w-full object-contain"
                                />
                            </div>
                            {/* Editing Controls and Confirm Button - Adapted for Cropper.js v2 API */}
                            {showPreviewModal.cropperImageElement && (
                                <div className="px-4 sm:px-6 py-4 border-t border-border-light flex-shrink-0">
                                    <div className="mb-4">
                                        <h4 className="text-sm font-medium text-text mb-3 flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">
                                                tune
                                            </span>
                                            编辑工具
                                        </h4>
                                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$zoom?.(
                                                        0.1,
                                                    )
                                                }
                                                title="放大"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    zoom_in
                                                </span>
                                                <span className="hidden sm:inline">
                                                    放大
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$zoom?.(
                                                        -0.1,
                                                    )
                                                }
                                                title="缩小"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    zoom_out
                                                </span>
                                                <span className="hidden sm:inline">
                                                    缩小
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$rotate?.(
                                                        '45deg',
                                                    )
                                                }
                                                title="右旋45°"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    rotate_right
                                                </span>
                                                <span className="hidden sm:inline">
                                                    右旋
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$rotate?.(
                                                        '-45deg',
                                                    )
                                                }
                                                title="左旋45°"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    rotate_left
                                                </span>
                                                <span className="hidden sm:inline">
                                                    左旋
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$scale?.(
                                                        -1,
                                                        1,
                                                    )
                                                }
                                                title="水平翻转"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    flip
                                                </span>
                                                <span className="hidden sm:inline">
                                                    水平
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-secondary-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() =>
                                                    showPreviewModal.cropperImageElement?.$scale?.(
                                                        1,
                                                        -1,
                                                    )
                                                }
                                                title="垂直翻转"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    flip
                                                </span>
                                                <span className="hidden sm:inline">
                                                    垂直
                                                </span>
                                            </button>
                                            <button
                                                className="btn-enhanced btn-warning-enhanced px-2 py-2 text-xs flex items-center justify-center gap-1 sm:px-3 sm:text-sm sm:gap-2"
                                                onClick={() => {
                                                    showPreviewModal.cropperImageElement?.$resetTransform?.();
                                                    showPreviewModal.cropperImageElement?.$center?.(
                                                        'contain',
                                                    );
                                                    showPreviewModal.cropperSelectionElement?.$reset?.();
                                                }}
                                                title="重置"
                                            >
                                                <span className="material-symbols-outlined text-sm">
                                                    refresh
                                                </span>
                                                <span className="hidden sm:inline">
                                                    重置
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border-light flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end flex-shrink-0">
                                <button
                                    className="btn-enhanced btn-secondary-enhanced px-4 py-2 sm:px-6 sm:py-3 flex items-center justify-center gap-2 text-sm sm:text-base"
                                    onClick={closePreviewModal}
                                >
                                    <span className="material-symbols-outlined text-sm">
                                        close
                                    </span>
                                    取消编辑
                                </button>
                                <button
                                    className="btn-enhanced btn-primary-enhanced px-4 py-2 sm:px-6 sm:py-3 flex items-center justify-center gap-2 text-sm sm:text-base"
                                    onClick={async () => {
                                        if (
                                            showPreviewModal &&
                                            showPreviewModal.cropperSelectionElement
                                        ) {
                                            const selectionElement =
                                                showPreviewModal.cropperSelectionElement;
                                            const cropperImageElement =
                                                showPreviewModal.cropperImageElement;
                                            const originalFile =
                                                showPreviewModal.file;

                                            if (!cropperImageElement) {
                                                console.error(
                                                    'Cropper image element not found.',
                                                );
                                                closePreviewModal();
                                                return;
                                            }

                                            try {
                                                const imageTransform =
                                                    cropperImageElement.$getTransform?.(); // [a, b, c, d, e, f]
                                                const scaleX = imageTransform
                                                    ? imageTransform[0]
                                                    : 1;
                                                const scaleY = imageTransform
                                                    ? imageTransform[3]
                                                    : 1;

                                                // Ensure selectionElement.width and height are numbers
                                                const selectionWidth =
                                                    typeof selectionElement.width ===
                                                    'number'
                                                        ? selectionElement.width
                                                        : 0;
                                                const selectionHeight =
                                                    typeof selectionElement.height ===
                                                    'number'
                                                        ? selectionElement.height
                                                        : 0;

                                                // Calculate output dimensions based on original image resolution for the selected area
                                                const outputWidth = Math.round(
                                                    selectionWidth / scaleX,
                                                );
                                                const outputHeight = Math.round(
                                                    selectionHeight / scaleY,
                                                );

                                                if (
                                                    outputWidth === 0 ||
                                                    outputHeight === 0
                                                ) {
                                                    console.error(
                                                        'Calculated output dimensions are zero, cannot crop.',
                                                    );
                                                    closePreviewModal();
                                                    return;
                                                }

                                                // Get the cropped canvas from the selection element
                                                const canvas =
                                                    await selectionElement.$toCanvas(
                                                        {
                                                            width: outputWidth,
                                                            height: outputHeight,
                                                        },
                                                    );

                                                if (canvas) {
                                                    let quality = 0.92; // Default quality for lossy formats
                                                    if (
                                                        originalFile.type ===
                                                        'image/png'
                                                    ) {
                                                        // PNG is lossless, quality parameter is ignored by toBlob for PNG.
                                                        // For other types like jpeg/webp, 0.92 is a good starting point.
                                                    }

                                                    canvas.toBlob(
                                                        (blob: Blob | null) => {
                                                            if (blob) {
                                                                const editedFile =
                                                                    new File(
                                                                        [blob],
                                                                        originalFile.name,
                                                                        {
                                                                            type:
                                                                                blob.type ||
                                                                                originalFile.type, // Fallback to original type if blob.type is empty
                                                                            lastModified:
                                                                                Date.now(),
                                                                        },
                                                                    );

                                                                const fileIndex =
                                                                    currentFiles.findIndex(
                                                                        (f) =>
                                                                            f.name ===
                                                                                originalFile.name &&
                                                                            f.lastModified ===
                                                                                originalFile.lastModified &&
                                                                            f.size ===
                                                                                originalFile.size,
                                                                    );

                                                                if (
                                                                    fileIndex !==
                                                                    -1
                                                                ) {
                                                                    setCurrentFiles(
                                                                        (
                                                                            prevFiles,
                                                                        ) => {
                                                                            const newFiles =
                                                                                [
                                                                                    ...prevFiles,
                                                                                ];
                                                                            newFiles[
                                                                                fileIndex
                                                                            ] =
                                                                                editedFile;
                                                                            return newFiles;
                                                                        },
                                                                    );
                                                                } else {
                                                                    // Fallback if original file somehow changed or was removed
                                                                    setCurrentFiles(
                                                                        (
                                                                            prevFiles,
                                                                        ) => [
                                                                            ...prevFiles,
                                                                            editedFile,
                                                                        ],
                                                                    );
                                                                }
                                                            } else {
                                                                console.error(
                                                                    'Failed to convert canvas to Blob.',
                                                                );
                                                            }
                                                            closePreviewModal();
                                                        },
                                                        originalFile.type,
                                                        quality,
                                                    );
                                                } else {
                                                    console.error(
                                                        'Failed to get canvas from cropper selection.',
                                                    );
                                                    closePreviewModal();
                                                }
                                            } catch (error) {
                                                console.error(
                                                    'Error getting cropped canvas:',
                                                    error,
                                                );
                                                closePreviewModal();
                                            }
                                        } else {
                                            console.warn(
                                                'Cropper selection element not found, cannot save.',
                                            );
                                            closePreviewModal();
                                        }
                                    }}
                                >
                                    <span className="material-symbols-outlined text-sm">
                                        check
                                    </span>
                                    确认修改
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </Fragment>
    );
}
