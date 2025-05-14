import { Fragment } from 'preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { actions } from 'astro:actions';
import { escapeHtml } from "~/lib/utils";
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

export default function ImageUploader() {
  const [currentFiles, setCurrentFiles] = useState<File[]>([]);
  const [uploadDirectory, setUploadDirectory] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadResult, setUploadResult] = useState<UploadResultState>(null);
  const [pastedImagePreviews, setPastedImagePreviews] = useState<Array<{ file: File, url: string }>>([]);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState<{ file: File, url: string, cropperInstance?: Cropper, cropperImageElement?: any, cropperSelectionElement?: any } | null>(null); // cropper elements are HTMLElement
  const imagePreviewRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Fetch app settings when component mounts
    const fetchAppSettings = async () => {
      try {
        const result = await actions.admin.getAppSettings({});
        if (result.data) {
          setAppSettings(result.data);
        } else if (result.error) {
          console.error("Failed to fetch app settings:", result.error.message);
          // Initialize with default if fetch fails, so WebP conversion defaults to off
          setAppSettings({ convertToWebP: false });
        }
      } catch (error) {
        console.error("Error fetching app settings:", error);
        setAppSettings({ convertToWebP: false });
      }
    };
    fetchAppSettings();
  }, []);

  // Helper function to add new files, ensuring no duplicates
  const addFilesToState = useCallback((newFilesArray: File[]) => {
    if (newFilesArray.length === 0) return;

    setCurrentFiles(prevFiles => {
      const imageFiles = newFilesArray.filter(file => file.type.startsWith('image/'));
      const trulyNewFiles = imageFiles.filter(newFile =>
        !prevFiles.some(existingFile =>
          existingFile.name === newFile.name &&
          existingFile.size === newFile.size &&
          existingFile.lastModified === newFile.lastModified
        )
      );
      return [...prevFiles, ...trulyNewFiles];
    });
  }, []);

  // Effect for managing pasted image previews and their object URLs
  useEffect(() => {
    const newPreviews = currentFiles.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setPastedImagePreviews(newPreviews);

    return () => {
      newPreviews.forEach(preview => URL.revokeObjectURL(preview.url));
    };
  }, [currentFiles]);

  const selectedFileNamesText = useMemo(() => {
    if (currentFiles.length > 0) {
      let fileNames = currentFiles.map(file => escapeHtml(file.name)).join(', ');
      if (fileNames.length > 100) fileNames = fileNames.substring(0, 97) + '...';
      return `<strong>已选择 (${currentFiles.length}):</strong> ${fileNames}`;
    }
    return '';
  }, [currentFiles]);

  const handleFileDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement)?.classList.remove('border-text');
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      addFilesToState(Array.from(event.dataTransfer.files));
    }
  }, [addFilesToState]);

  const handleFileInputChange = useCallback((event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      addFilesToState(Array.from(input.files));
    }
  }, [addFilesToState]);

  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();

    let processedAnyContent = false;
    const newFilesBatch: File[] = [];

    if (event.clipboardData.items) {
      const items = Array.from(event.clipboardData.items);
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) newFilesBatch.push(file);
          processedAnyContent = true;
        } else if (item.kind === 'string' && item.type === 'text/plain') {
          const text = await new Promise<string>(resolve => item.getAsString(resolve));
          if (text.match(/^https?:\/\/.*\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i)) {
            try {
              const response = await fetch(text);
              if (!response.ok) continue;
              const blob = await response.blob();
              if (blob.type.startsWith('image/')) {
                const urlParts = text.split('/');
                let fileName = urlParts[urlParts.length - 1].split('?')[0] || 'image.jpg';
                const file = new File([blob], fileName, { type: blob.type });
                newFilesBatch.push(file);
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
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = blob.type.split('/')[1] || 'png';
            const fileName = `clipboard-image-${timestamp}.${extension}`;
            const file = new File([blob], fileName, { type: blob.type });
            newFilesBatch.push(file);
            processedAnyContent = true;
          }
        }
      }
    }

    if (!processedAnyContent && event.clipboardData.getData('text/html')) {
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
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = blob.type.split('/')[1] || 'png';
            const fileName = `embedded-image-${timestamp}.${extension}`;
            const file = new File([blob], fileName, { type: blob.type });
            newFilesBatch.push(file);
          } catch (e) {
            console.error('处理嵌入图片失败:', e);
          }
        }
      }
    }

    if (newFilesBatch.length > 0) {
      addFilesToState(newFilesBatch);
    }
  }, [addFilesToState]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]);

  const removeFile = useCallback((indexToRemove: number) => {
    setCurrentFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
  }, []);

  const handleUpload = async () => {
    if (currentFiles.length === 0) {
      setUploadResult({ success: false, message: '请选择要上传的文件。', results: [], error: true });
      return;
    }

    setUploading(true);
    setUploadResult(null);

    const filesToUpload: File[] = [];
    const conversionResults: Array<{ originalName: string, newName?: string, status: 'converted' | 'failed' | 'skipped' }> = [];

    const shouldConvertToWebP = appSettings?.convertToWebP || false;

    for (const file of currentFiles) {
      if (shouldConvertToWebP && file.type.startsWith('image/') && file.type !== 'image/webp' && file.type !== 'image/svg+xml') {
        try {
          const image = new Image();
          const reader = new FileReader();

          const conversionPromise = new Promise<{ success: boolean, file: File, originalName: string, newName?: string }>((resolve, reject) => {
            reader.onload = (e) => {
              image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  reject(new Error('Failed to get canvas context.'));
                  return;
                }
                ctx.drawImage(image, 0, 0);
                canvas.toBlob(blob => {
                  if (blob) {
                    const newFileName = file.name.substring(0, file.name.lastIndexOf('.')) + '.webp';
                    resolve({ success: true, file: new File([blob], newFileName, { type: 'image/webp' }), originalName: file.name, newName: newFileName });
                  } else {
                    resolve({ success: false, file: file, originalName: file.name }); // Conversion failed, use original
                  }
                }, 'image/webp', 0.8); // 0.8 quality
              };
              image.onerror = () => resolve({ success: false, file: file, originalName: file.name }); // Image load error
              if (e.target?.result) {
                image.src = e.target.result as string;
              } else {
                resolve({ success: false, file: file, originalName: file.name }); // FileReader error
              }
            };
            reader.onerror = () => resolve({ success: false, file: file, originalName: file.name }); // FileReader error
            reader.readAsDataURL(file);
          });

          const result = await conversionPromise;
          filesToUpload.push(result.file);
          conversionResults.push({ originalName: result.originalName, newName: result.newName, status: result.success ? 'converted' : 'failed' });

        } catch (error) {
          console.error(`Error converting ${file.name} to WebP:`, error);
          filesToUpload.push(file); // Use original on error
          conversionResults.push({ originalName: file.name, status: 'failed' });
        }
      } else {
        filesToUpload.push(file);
        conversionResults.push({ originalName: file.name, status: 'skipped' });
      }
    }

    const formData = new FormData();
    filesToUpload.forEach(file => formData.append('files', file));

    const uploadDir = uploadDirectory.trim();
    if (uploadDir) {
      formData.append('uploadDirectory', uploadDir);
    }

    try {
      const actionResponse = await actions.image.upload(formData);

      if (actionResponse.error) {
        let errorMessage = actionResponse.error.message;
        if (actionResponse.error.code === 'BAD_REQUEST' && (actionResponse.error as any).fields) {
          const fieldErrors = Object.values((actionResponse.error as any).fields).flat().join(', ');
          errorMessage = fieldErrors || actionResponse.error.message;
        }
        setUploadResult({
          success: false,
          message: `上传失败: ${errorMessage}`,
          results: filesToUpload.map(f => {
            const convRes = conversionResults.find(cr => (cr.newName || cr.originalName) === f.name);
            return { success: false, fileName: f.name, message: "上传失败", conversionStatus: convRes?.status };
          }),
          error: true
        });
      } else if (actionResponse.data) {
        // Ensure backendResult and its critical properties are not null/undefined before proceeding
        const rawBackendResult = actionResponse.data as Partial<UploadResultState>; // Use Partial to handle potentially missing fields safely

        if (rawBackendResult && typeof rawBackendResult.success === 'boolean' && Array.isArray(rawBackendResult.results)) {
          const backendResult: UploadResultState = { // Explicitly cast to UploadResultState after checks
            success: rawBackendResult.success,
            message: rawBackendResult.message || (rawBackendResult.success ? "上传操作已处理。" : "上传操作部分失败或包含错误。"),
            results: rawBackendResult.results.map(r => ({
              success: !!r.success, // Ensure boolean
              fileName: r.fileName || "未知文件",
              data: r.data,
              message: r.message,
              conversionStatus: r.conversionStatus, // This will be updated next
            })),
            error: !rawBackendResult.success, // Add error field based on success
          };
          
          // Merge conversion status with backend results
          const finalResults = backendResult.results.map(br => {
            const convRes = conversionResults.find(cr => (cr.newName || cr.originalName) === br.fileName);
            return { ...br, conversionStatus: convRes?.status || br.conversionStatus || 'skipped' };
          });

          setUploadResult({ ...backendResult, results: finalResults }); // error is already part of backendResult

          if (backendResult.success) {
            setCurrentFiles([]);
          } else {
            const successfullyUploadedAndProcessedFileNames = finalResults
              .filter(r => r.success && r.data)
              .map(r => r.fileName);

            const originalNamesOfSuccessfullyUploaded = successfullyUploadedAndProcessedFileNames.map(uploadedName => {
              const convRes = conversionResults.find(cr => cr.newName === uploadedName);
              return convRes ? convRes.originalName : uploadedName;
            });

            setCurrentFiles(prevFiles => prevFiles.filter(
              originalFile => !originalNamesOfSuccessfullyUploaded.includes(originalFile.name)
            ));
          }
        } else { // rawBackendResult is not as expected
          setUploadResult({ success: false, message: "上传响应格式不正确或不完整。", results: [], error: true });
        }
      } else { // actionResponse.data is null/undefined
        setUploadResult({ success: false, message: "上传响应格式错误 (无数据)。", results: [], error: true });
      }
    } catch (error: any) {
      console.error('Upload error:', error.message);
      setUploadResult({
        success: false,
        message: `上传失败: ${error.message || '未知网络错误'}`,
        results: filesToUpload.map(f => {
            const convRes = conversionResults.find(cr => (cr.newName || cr.originalName) === f.name);
            return { success: false, fileName: f.name, message: "上传失败", conversionStatus: convRes?.status };
        }),
        error: true
      });
    } finally {
      setUploading(false);
    }
  };

  const openPreviewModal = (file: File, url: string) => {
    const modalUrl = URL.createObjectURL(file);
    // setShowPreviewModal({ file, url: modalUrl });
    // Initialize Cropper after the modal is shown and image is loaded
    // We'll set a temporary state, then initialize cropper in an effect
    setShowPreviewModal({ file, url: modalUrl, cropperInstance: undefined });
  };

  const closePreviewModal = () => {
    if (showPreviewModal) {

      URL.revokeObjectURL(showPreviewModal.url);
      setShowPreviewModal(null);
    }
  };

  useEffect(() => {
    if (showPreviewModal && imagePreviewRef.current && !showPreviewModal.cropperInstance) {
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
      const cropper = new Cropper(imagePreviewRef.current, { template });

      // Ensure the cropper canvas fills the available height
      const cropperCanvasEl = cropper.container?.querySelector('cropper-canvas');
      if (cropperCanvasEl) {
        (cropperCanvasEl as HTMLElement).style.height = '60vh'; // Set explicit height for cropper-canvas
      }

      const cropperImageElem = cropper.getCropperImage();
      const cropperSelectionElem = cropper.getCropperSelection();

      setShowPreviewModal(prev => prev ? { ...prev, cropperInstance: cropper, cropperImageElement: cropperImageElem, cropperSelectionElement: cropperSelectionElem } : null);
    }
  }, [showPreviewModal]);


  // JSX for the component
  return (
    <Fragment>
      <div class="upload-section border bg-background rounded-lg shadow-xl p-8 md:p-12 lg:p-14 mb-8">
        <div
          id="drop-zone"
          class="border-2 border-dashed border-border p-10 text-center cursor-pointer hover:border-text transition-colors rounded-lg"
          onClick={() => (document.getElementById('file-input') as HTMLInputElement)?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-text'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('border-text')}
          onDrop={handleFileDrop}
          onPaste={handlePaste} // Also allow paste directly on drop-zone
        >
          <p class="text-lg mb-2">拖拽文件到此处，点击选择，或直接粘贴图片</p>
          <p class="text-sm text-gray-700 mb-2">(支持批量上传)</p>
          <input type="file" id="file-input" multiple class="hidden" accept="image/*" onChange={handleFileInputChange} />
          {selectedFileNamesText && (
            <div class="mt-2 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: selectedFileNamesText }}></div>
          )}
          {pastedImagePreviews.length > 0 && (
            <div class="mt-4 flex flex-wrap gap-2 justify-center">
              {pastedImagePreviews.map((preview, index) => (
                <div
                  key={`${preview.file.name}-${preview.file.lastModified}`}
                  class="relative w-24 h-24 border border-border overflow-hidden cursor-pointer rounded-md"
                  onClick={(e) => { e.stopPropagation(); openPreviewModal(preview.file, preview.url); }}
                >
                  <img src={preview.url} alt={`预览 ${escapeHtml(preview.file.name)}`} class="w-full h-full object-cover" />
                  <button
                    type="button"
                    class="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs leading-none hover:bg-red-700 focus:outline-none"
                    title={`移除 ${escapeHtml(preview.file.name)}`}
                    onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div class="mt-8">
          <label for="upload-directory" class="block font-medium mb-1">指定上传目录 (可选)</label>
          <input
            type="text"
            id="upload-directory"
            name="upload-directory"
            placeholder="例如：wallpapers/nature"
            class="w-full p-2 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text"
            value={uploadDirectory}
            onInput={(e) => setUploadDirectory((e.target as HTMLInputElement).value)}
          />
        </div>

        <button
          id="upload-button"
          class="mt-6 w-full bg-text text-background py-2 px-4 border border-transparent hover:opacity-90 transition-opacity rounded-md"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? `正在上传 ${currentFiles.length} 个文件...` : '上传'}
        </button>
      </div>

      {uploadResult && (
        <div class="links-section border border-border bg-background rounded-lg shadow-xl p-6 md:p-8">
          <h2 class={`text-2xl font-semibold mb-4 ${uploadResult.error ? 'text-red-500' : (uploadResult.success ? 'text-green-600' : 'text-yellow-600')}`}>
            {uploadResult.error ? '上传出错' : (uploadResult.success ? '上传成功！' : '部分上传成功')}
          </h2>
          <div id="uploaded-links" class="space-y-4">
            <p class={`mb-4 ${uploadResult.error ? 'text-red-500' : (uploadResult.success ? 'text-green-600' : 'text-yellow-600')}`}>
              {escapeHtml(uploadResult.message)}
            </p>
            {uploadResult.results.map((fileResult, index) => (
              <div key={`${fileResult.fileName}-${index}`} class={`p-4 border rounded-md mb-2 ${fileResult.success ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                <p class="font-medium mb-1 break-all">
                  {`${escapeHtml(fileResult.fileName)}: ${fileResult.success ? '成功' : '失败'}`}
                  {fileResult.conversionStatus === 'failed' && <span class="text-xs text-orange-500 ml-2">(WebP转换失败)</span>}
                  {fileResult.conversionStatus === 'converted' && <span class="text-xs text-green-500 ml-2">(已转为WebP)</span>}
                </p>
                {fileResult.success && fileResult.data && (
                  <div class="space-y-1 mt-1">
                    {['url', 'markdown', 'html'].map(formatKey => {
                      const uploadedFile = fileResult.data!;
                      let value = '';
                      let label = '';
                      switch (formatKey) {
                        case 'url':
                          value = uploadedFile.url;
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

                      const copyToClipboard = (textToCopy: string, feedbackId: string) => {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                          const feedbackEl = document.getElementById(feedbackId);
                          if (feedbackEl) {
                            feedbackEl.classList.remove('hidden');
                            setTimeout(() => feedbackEl.classList.add('hidden'), 1500);
                          }
                          // Auto-copy logic based on localStorage (simplified for brevity)
                          if (formatKey.toLowerCase() === (localStorage.getItem('defaultCopyFormat') || 'url').toLowerCase()) {
                            // This part of auto-copying on initial display might need more nuanced handling
                            // if multiple files are uploaded, as it would try to auto-copy for each.
                            // For now, the click-to-copy is primary.
                          }
                        }).catch(err => {
                          console.error(`Could not copy ${label}: `, err);
                          const feedbackEl = document.getElementById(feedbackId);
                          if (feedbackEl) {
                            feedbackEl.textContent = '复制失败';
                            feedbackEl.className = 'text-xs text-red-500 ml-2';
                            feedbackEl.classList.remove('hidden');
                            setTimeout(() => {
                              feedbackEl.classList.add('hidden');
                              feedbackEl.textContent = '已复制!'; // Reset
                              feedbackEl.className = 'text-xs text-green-500 ml-2 hidden';
                            }, 2000);
                          }
                        });
                      };
                      const inputId = `link-${fileResult.fileName}-${formatKey}-${index}`;
                      const feedbackId = `feedback-${fileResult.fileName}-${formatKey}-${index}`;

                      return (
                        <div key={formatKey}>
                          <span class="font-semibold text-xs">{label}: </span>
                          <input
                            id={inputId}
                            type="text"
                            readOnly
                            value={value}
                            class="w-full p-1 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text text-xs"
                            onFocus={(e) => (e.target as HTMLInputElement).select()}
                            onClick={() => copyToClipboard(value, feedbackId)}
                          />
                          <span id={feedbackId} class="text-xs text-green-500 ml-2 hidden">已复制!</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!fileResult.success && fileResult.message && (
                  <p class="text-red-600 text-sm">原因: {escapeHtml(fileResult.message)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showPreviewModal && (
        <div
          id="image-preview-modal"
          style={{
            position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
            backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1000
          }}
          onClick={closePreviewModal} // Clicking background closes modal
        >
          {/* Modal content container to prevent close on click */}
          <div class="bg-background p-4 rounded-lg shadow-xl w-full max-w-[95vw] md:max-w-2xl lg:max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div class="flex-1 overflow-hidden min-h-[65vh]"> {/* Increased min-height */}
              <img
                ref={imagePreviewRef}
                src={showPreviewModal.url}
                alt={`编辑 ${escapeHtml(showPreviewModal.file.name)}`}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} // Let image fill container, object-fit handles aspect ratio
              />
            </div>
            {/* Editing Controls and Confirm Button - Adapted for Cropper.js v2 API */}
            {showPreviewModal.cropperImageElement && (
              <div class="mt-4 p-2 space-x-2 text-center">
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$zoom?.(0.1)} title="放大">放大</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$zoom?.(-0.1)} title="缩小">缩小</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$rotate?.('45deg')} title="右旋45°">右旋</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$rotate?.('-45deg')} title="左旋45°">左旋</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$scale?.(-1, 1)} title="水平翻转">水平翻转</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => showPreviewModal.cropperImageElement?.$scale?.(1, -1)} title="垂直翻转">垂直翻转</button>
                <button class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded" onClick={() => {
                  showPreviewModal.cropperImageElement?.$resetTransform?.();
                  showPreviewModal.cropperImageElement?.$center?.();
                  showPreviewModal.cropperSelectionElement?.$reset?.();
                }} title="重置">重置</button>
              </div>
            )}
            <div class="mt-4 text-right space-x-2">
              <button
                class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                onClick={closePreviewModal}
              >
                取消
              </button>
              <button
                class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                onClick={async () => {
                  if (showPreviewModal && showPreviewModal.cropperSelectionElement) {
                    const selectionElement = showPreviewModal.cropperSelectionElement;
                    const cropperImageElement = showPreviewModal.cropperImageElement;
                    const originalFile = showPreviewModal.file;

                    if (!cropperImageElement) {
                      console.error("Cropper image element not found.");
                      closePreviewModal();
                      return;
                    }

                    try {
                      const imageTransform = cropperImageElement.$getTransform?.(); // [a, b, c, d, e, f]
                      const scaleX = imageTransform ? imageTransform[0] : 1;
                      const scaleY = imageTransform ? imageTransform[3] : 1;

                      // Ensure selectionElement.width and height are numbers
                      const selectionWidth = typeof selectionElement.width === 'number' ? selectionElement.width : 0;
                      const selectionHeight = typeof selectionElement.height === 'number' ? selectionElement.height : 0;
                      
                      // Calculate output dimensions based on original image resolution for the selected area
                      const outputWidth = Math.round(selectionWidth / scaleX);
                      const outputHeight = Math.round(selectionHeight / scaleY);

                      if (outputWidth === 0 || outputHeight === 0) {
                        console.error("Calculated output dimensions are zero, cannot crop.");
                        closePreviewModal();
                        return;
                      }
                      
                      // Get the cropped canvas from the selection element
                      const canvas = await selectionElement.$toCanvas({
                        width: outputWidth,
                        height: outputHeight,
                      });

                      if (canvas) {
                        let quality = 0.92; // Default quality for lossy formats
                        if (originalFile.type === 'image/png') {
                           // PNG is lossless, quality parameter is ignored by toBlob for PNG.
                           // For other types like jpeg/webp, 0.92 is a good starting point.
                        }

                        canvas.toBlob((blob: Blob | null) => {
                          if (blob) {
                            const editedFile = new File([blob], originalFile.name, {
                              type: blob.type || originalFile.type, // Fallback to original type if blob.type is empty
                              lastModified: Date.now()
                            });

                            const fileIndex = currentFiles.findIndex(f =>
                              f.name === originalFile.name &&
                              f.lastModified === originalFile.lastModified &&
                              f.size === originalFile.size
                            );

                            if (fileIndex !== -1) {
                              setCurrentFiles(prevFiles => {
                                const newFiles = [...prevFiles];
                                newFiles[fileIndex] = editedFile;
                                return newFiles;
                              });
                            } else {
                              // Fallback if original file somehow changed or was removed
                              setCurrentFiles(prevFiles => [...prevFiles, editedFile]);
                            }
                          } else {
                            console.error('Failed to convert canvas to Blob.');
                          }
                          closePreviewModal();
                        }, originalFile.type, quality); 
                      } else {
                        console.error('Failed to get canvas from cropper selection.');
                        closePreviewModal();
                      }
                    } catch (error) {
                      console.error('Error getting cropped canvas:', error);
                      closePreviewModal();
                    }
                  } else {
                    console.warn("Cropper selection element not found, cannot save.");
                    closePreviewModal();
                  }
                }}
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
}
