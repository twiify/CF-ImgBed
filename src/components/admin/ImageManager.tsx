import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { actions } from 'astro:actions';
import { escapeHtml } from '~/lib/utils';

import AlertModal from '~/components/admin/AlertModal';
import ConfirmModal from '~/components/admin/ConfirmModal';
import PromptModal from '~/components/admin/PromptModal';

// Define the structure for images
interface ImageMetadata {
    id: string;
    fileName: string;
    size: number;
    uploadedAt: string;
    r2Key: string;
}

const ImageManager: FunctionalComponent = () => {
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [directories, setDirectories] = useState<string[]>([]);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [currentDirectoryPath, setCurrentDirectoryPath] = useState<string>('');
    const [currentDirectoryTotalSize, setCurrentDirectoryTotalSize] = useState<number | undefined>(undefined);
    const [appSettings, setAppSettings] = useState<{ customImagePrefix?: string } | null>(null);
    const imageAccessPrefix = appSettings?.customImagePrefix || 'img';

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Modal states
    const [alertModal, setAlertModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
    }>({ isOpen: false, title: '', message: '' });

    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        onCancel: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => {},
        onCancel: () => {},
    });

    const [promptModal, setPromptModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        initialValue: string;
        inputPlaceholder?: string;
        onConfirm: (value: string | null) => void;
        onCancel: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        initialValue: '',
        inputPlaceholder: '输入目录名称...',
        onConfirm: () => {},
        onCancel: () => {},
    });

    const showAlert = useCallback((title: string, message: string) => {
        setAlertModal({ isOpen: true, title, message });
    }, []);

    const closeAlertModal = useCallback(() => {
        setAlertModal((s) => ({ ...s, isOpen: false }));
    }, []);

    const showConfirm = useCallback(
        (title: string, message: string): Promise<boolean> => {
            return new Promise((resolve) => {
                const handleConfirm = () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    resolve(true);
                };
                const handleCancel = () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    resolve(false);
                };
                setConfirmModal({
                    isOpen: true,
                    title,
                    message,
                    onConfirm: handleConfirm,
                    onCancel: handleCancel,
                });
            });
        },
        [],
    );

    const showPrompt = useCallback(
        (title: string, message: string, initialValue: string = ''): Promise<string | null> => {
            return new Promise((resolve) => {
                setPromptModal({
                    isOpen: true,
                    title,
                    message,
                    initialValue,
                    inputPlaceholder: '输入目录名称...',
                    onConfirm: (value: string | null) => {
                        setPromptModal((s) => ({ ...s, isOpen: false }));
                        resolve(value);
                    },
                    onCancel: () => {
                        setPromptModal((s) => ({ ...s, isOpen: false }));
                        resolve(null);
                    },
                });
            });
        },
        [],
    );

    // Utility function to format bytes
    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Fetch app settings
    const fetchAppSettings = useCallback(async () => {
        try {
            const result = await actions.admin.getAppSettings({});
            if (result.error) throw result.error;
            setAppSettings(result.data ?? { customImagePrefix: 'img' });
        } catch (e) {
            setAppSettings({ customImagePrefix: 'img' });
        }
    }, []);

    // Fetch directory contents
    const fetchDirectoryContents = useCallback(async (directoryPath: string = '') => {
        setIsLoading(true);
        setErrorMessage(null);
        setSelectedItems(new Set());

        try {
            const result = await actions.image.listDirectoryContents({ path: directoryPath });
            if (result.error) {
                throw new Error(result.error.message);
            }

            if (result.data) {
                setImages(result.data.images || []);
                setDirectories(result.data.directories || []);
                setCurrentDirectoryPath(directoryPath);
                setCurrentDirectoryTotalSize(result.data.currentDirectoryTotalSize || null);
            }
        } catch (error: any) {
            console.error('Failed to fetch directory contents:', error);
            setErrorMessage(`无法加载目录内容: ${error.message}`);
            showAlert('加载失败', `无法加载目录内容: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [showAlert]);

    // Initialize app settings and directory contents
    useEffect(() => {
        const initialize = async () => {
            await fetchAppSettings();
            await fetchDirectoryContents('');
        };
        initialize();
    }, [fetchAppSettings, fetchDirectoryContents]);

    // Selection handling
    const selectedImageIds = useMemo(
        () => images.filter((img) => selectedItems.has(img.id)).map((img) => img.id),
        [images, selectedItems],
    );

    const hasSelectedImages = selectedImageIds.length > 0;
    const totalSelectedCount = selectedItems.size;
    const allCurrentlySelected = useMemo(() => {
        const allImageIds = images.map((img) => img.id);
        return allImageIds.length > 0 && allImageIds.every((id) => selectedItems.has(id));
    }, [images, selectedItems]);

    const handleSelectAllChange = useCallback((e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        const allImageIds = images.map((img) => img.id);

        if (checked) {
            setSelectedItems(new Set(allImageIds));
        } else {
            setSelectedItems(new Set());
        }
    }, [images]);

    const handleItemCheckboxChange = useCallback((itemId: string, itemType: 'image' | 'directory', checked: boolean) => {
        setSelectedItems((prev) => {
            const newSelected = new Set(prev);
            if (checked) {
                newSelected.add(itemId);
            } else {
                newSelected.delete(itemId);
            }
            return newSelected;
        });
    }, []);

    // Delete items
    const deleteItems = useCallback(async (imageIds: string[], isSingle: boolean) => {
        if (imageIds.length === 0) return;

        const confirmMessage = isSingle
            ? `确定要删除这张图片吗？此操作不可撤销。`
            : `确定要删除 ${imageIds.length} 张选中的图片吗？此操作不可撤销。`;

        const confirmed = await showConfirm('确认删除', confirmMessage);
        if (!confirmed) return;

        setIsProcessing(true);
        try {
            const result = await actions.image.deleteImagesAction({ imageIds });
            if (result.error) {
                throw new Error(result.error.message);
            }

            showAlert('删除成功', result.data?.message || '图片已成功删除');
            fetchDirectoryContents(currentDirectoryPath);
            setSelectedItems(new Set());
        } catch (error: any) {
            console.error('Failed to delete images:', error);
            showAlert('删除失败', `删除图片失败: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    }, [showConfirm, showAlert, fetchDirectoryContents, currentDirectoryPath]);

    // Move items
    const promptForDirectoryAndMove = useCallback(async (imageIds: string[], isSingle: boolean) => {
        if (imageIds.length === 0) return;

        const directoryPath = await showPrompt(
            '移动图片',
            `请输入目标目录路径 (留空表示根目录):`,
            currentDirectoryPath
        );

        if (directoryPath === null) return;

        setIsProcessing(true);
        try {
            const result = await actions.image.moveImagesAction({
                imageIds,
                targetDirectory: directoryPath.trim()
            });

            if (result.error) {
                throw new Error(result.error.message);
            }

            showAlert('移动成功', result.data?.message || '图片已成功移动');
            fetchDirectoryContents(currentDirectoryPath);
            setSelectedItems(new Set());
        } catch (error: any) {
            console.error('Failed to move images:', error);
            showAlert('移动失败', `移动图片失败: ${error.message}`);
        } finally {
            setIsProcessing(false);
        }
    }, [showPrompt, showAlert, fetchDirectoryContents, currentDirectoryPath]);

    // Render content
    let content;
    if (errorMessage && !alertModal.isOpen && images.length === 0 && directories.length === 0) {
        content = (
            <div className="card-enhanced p-8 text-center border-error/20 bg-error/5">
                <div className="flex items-center justify-center mb-4">
                    <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center">
                        <span className="material-symbols-outlined text-error text-2xl">error</span>
                    </div>
                </div>
                <h3 className="text-lg font-medium text-error mb-2">加载失败</h3>
                <p className="text-text-secondary">{escapeHtml(errorMessage)}</p>
                <button
                    className="btn-enhanced mt-4 px-4 py-2 bg-error/10 text-error border border-error/20 hover:bg-error/20"
                    onClick={() => window.location.reload()}
                >
                    重新加载
                </button>
            </div>
        );
    } else if (isLoading && images.length === 0 && directories.length === 0) {
        content = (
            <div className="card-enhanced p-8 text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                </div>
                <p className="text-text-secondary">
                    正在加载 <span className="font-medium text-text">{escapeHtml(currentDirectoryPath || '根目录')}</span> 中的内容...
                </p>
            </div>
        );
    } else if (!isLoading && images.length === 0 && directories.length === 0 && currentDirectoryPath === '') {
        content = (
            <div className="card-enhanced p-12 text-center">
                <div className="w-20 h-20 bg-primary/5 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <span className="material-symbols-outlined text-primary text-4xl">photo_library</span>
                </div>
                <h3 className="text-2xl font-bold text-text mb-3">暂无图片</h3>
                <p className="text-text-secondary mb-8 max-w-md mx-auto">
                    您的图床还没有任何图片。开始上传第一张图片，构建您的专属图片库吧！
                </p>
                <a
                    href="/"
                    className="btn-enhanced btn-primary-enhanced px-6 py-3 rounded-xl inline-flex items-center gap-2"
                >
                    <span className="material-symbols-outlined">add_photo_alternate</span>
                    <span>立即上传图片</span>
                </a>
            </div>
        );
    } else {
        content = (
            <div className="space-y-6">
                {/* Header with Breadcrumb */}
                <div className="card-enhanced p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                                <span className="material-symbols-outlined text-primary">folder_open</span>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-text">当前目录</h3>
                                <p className="text-text-secondary text-sm">浏览和管理图片文件</p>
                            </div>
                        </div>
                        {typeof currentDirectoryTotalSize === 'number' && (
                            <div className="flex items-center gap-2 text-sm text-text-secondary">
                                <span className="material-symbols-outlined text-xs">data_usage</span>
                                <span>总大小：{formatBytes(currentDirectoryTotalSize)}</span>
                            </div>
                        )}
                    </div>

                    {/* Breadcrumb */}
                    <div className="flex items-center space-x-2 flex-wrap text-sm">
                        <span className="material-symbols-outlined text-primary text-base">folder</span>
                        <button
                            className="text-primary hover:text-primary-dark transition-colors font-medium"
                            onClick={(e) => {
                                e.preventDefault();
                                fetchDirectoryContents('');
                            }}
                        >
                            根目录
                        </button>
                        {currentDirectoryPath
                            .split('/')
                            .filter((p) => p)
                            .map((segment, index, arr) => (
                                <>
                                    <span className="text-text-muted">/</span>
                                    {index === arr.length - 1 ? (
                                        <span className="text-text font-medium px-2 py-1 bg-primary/10 rounded-lg">
                                            {escapeHtml(segment)}
                                        </span>
                                    ) : (
                                        <button
                                            className="text-primary hover:text-primary-dark transition-colors font-medium"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                fetchDirectoryContents(
                                                    arr.slice(0, index + 1).join('/'),
                                                );
                                            }}
                                        >
                                            {escapeHtml(segment)}
                                        </button>
                                    )}
                                </>
                            ))}
                    </div>
                </div>

                {/* Loading overlay for existing content */}
                {(isLoading || isProcessing) && (images.length > 0 || directories.length > 0) && (
                    <div className="card-enhanced p-4 bg-primary/5 border-primary/20">
                        <div className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                            <span className="text-text-secondary">
                                {isProcessing ? '正在处理操作...' : '正在加载内容...'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Content Grid */}
                <div className="space-y-4">
                    {/* Empty state for subdirectory */}
                    {images.length === 0 && directories.length === 0 && currentDirectoryPath !== '' && !isLoading && (
                        <div className="card-enhanced p-12 text-center">
                            <div className="w-16 h-16 bg-primary/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <span className="material-symbols-outlined text-primary text-2xl">folder_open</span>
                            </div>
                            <p className="text-text-secondary">此目录为空。</p>
                        </div>
                    )}

                    {/* Directories */}
                    {directories.length > 0 && (
                        <div className="card-enhanced p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 bg-warning/10 rounded-lg flex items-center justify-center">
                                    <span className="material-symbols-outlined text-warning text-sm">folder</span>
                                </div>
                                <h4 className="font-medium text-text">文件夹</h4>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {directories.map((dirName, index) => (
                                    <div
                                        key={dirName}
                                        className="group p-4 border border-border-light rounded-xl hover:border-primary/20 hover:bg-primary/5 transition-all duration-200 cursor-pointer animate-fade-in"
                                        style={{ animationDelay: `${index * 50}ms` }}
                                        onClick={() => {
                                            fetchDirectoryContents(
                                                currentDirectoryPath
                                                    ? `${currentDirectoryPath}/${dirName}`
                                                    : dirName,
                                            );
                                        }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
                                                <span className="material-symbols-outlined text-warning">folder</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-text truncate">{escapeHtml(dirName)}</div>
                                                <div className="text-xs text-text-secondary">文件夹</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Images */}
                    {images.length > 0 && (
                        <div className="card-enhanced p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                                    <span className="material-symbols-outlined text-primary text-sm">photo_library</span>
                                </div>
                                <h4 className="font-medium text-text">图片文件</h4>
                                <span className="text-sm text-text-secondary">({images.length} 张)</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {images.map((image, index) => {
                                    const ext = image.fileName.includes('.') ? `.${image.fileName.split('.').pop()}` : '';
                                    const url = `/${imageAccessPrefix}/${image.id}${ext}`;
                                    return (
                                        <div
                                            key={image.id}
                                            className="group card-enhanced p-4 hover:shadow-lg transition-all duration-200 animate-fade-in"
                                            style={{ animationDelay: `${(directories.length + index) * 50}ms` }}
                                        >
                                            {/* Checkbox */}
                                            <div className="flex items-center justify-between mb-3">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 text-primary bg-background border-2 border-border rounded focus:ring-primary/20 focus:ring-2"
                                                    checked={selectedItems.has(image.id)}
                                                    onChange={(e) =>
                                                        handleItemCheckboxChange(
                                                            image.id,
                                                            'image',
                                                            (e.target as HTMLInputElement).checked,
                                                        )
                                                    }
                                                />
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs text-text-secondary">{formatBytes(image.size)}</span>
                                                </div>
                                            </div>

                                            {/* Image Preview */}
                                            <div className="aspect-square rounded-xl overflow-hidden bg-surface border border-border-light mb-3">
                                                <img
                                                    src={escapeHtml(url)}
                                                    alt={escapeHtml(image.fileName)}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                    loading="lazy"
                                                />
                                            </div>

                                            {/* Image Info */}
                                            <div className="space-y-2">
                                                <div className="text-sm font-medium text-text truncate" title={escapeHtml(image.fileName)}>
                                                    {escapeHtml(image.fileName)}
                                                </div>
                                                <div className="text-xs text-text-secondary">
                                                    {new Date(image.uploadedAt).toLocaleDateString('zh-CN')}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-surface border border-border-light text-text-secondary truncate" title={escapeHtml(image.id)}>
                                                        {escapeHtml(image.id.substring(0, 8))}...
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="mt-4 flex items-center gap-2">
                                                <button
                                                    className="btn-enhanced btn-ghost-enhanced flex-1 p-2 rounded-lg inline-flex items-center justify-center gap-1.5 text-sm hover:scale-105 transition-all duration-200"
                                                    onClick={() => window.open(url, '_blank')}
                                                    title="查看图片"
                                                >
                                                    <span className="material-symbols-outlined text-sm">visibility</span>
                                                </button>
                                                <button
                                                    className="btn-enhanced btn-ghost-enhanced flex-1 p-2 rounded-lg inline-flex items-center justify-center gap-1.5 text-sm hover:scale-105 transition-all duration-200"
                                                    onClick={() => promptForDirectoryAndMove([image.id], true)}
                                                    title="移动图片"
                                                >
                                                    <span className="material-symbols-outlined text-sm">drive_file_move</span>
                                                </button>
                                                <button
                                                    className="btn-enhanced btn-error-enhanced flex-1 p-2 rounded-lg inline-flex items-center justify-center gap-1.5 text-sm hover:scale-105 transition-all duration-200"
                                                    onClick={() => deleteItems([image.id], true)}
                                                    title="删除图片"
                                                >
                                                    <span className="material-symbols-outlined text-sm">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Batch Operations */}
                    {(images.length > 0 || directories.length > 0) && (
                        <div className="card-enhanced p-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                                        <span className="material-symbols-outlined text-primary text-sm">checklist</span>
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-text">批量操作</div>
                                        <div className="text-xs text-text-secondary">
                                            已选中 <span className="font-medium text-text">{totalSelectedCount}</span> 项
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 text-primary bg-background border-2 border-border rounded focus:ring-primary/20 focus:ring-2"
                                        onChange={handleSelectAllChange}
                                        checked={allCurrentlySelected}
                                        title={allCurrentlySelected ? "取消全选" : "全选"}
                                    />
                                    <button
                                        className="btn-enhanced btn-ghost-enhanced px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={!hasSelectedImages}
                                        onClick={() => promptForDirectoryAndMove(selectedImageIds, false)}
                                        title="批量移动选中的图片"
                                    >
                                        <span className="material-symbols-outlined text-sm">drive_file_move</span>
                                        <span>批量移动</span>
                                    </button>
                                    <button
                                        className="btn-enhanced btn-error-enhanced px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={!hasSelectedImages}
                                        onClick={() => deleteItems(selectedImageIds, false)}
                                        title="批量删除选中的图片"
                                    >
                                        <span className="material-symbols-outlined text-sm">delete</span>
                                        <span>批量删除</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <>
            {content}
            <AlertModal
                isOpen={alertModal.isOpen}
                title={alertModal.title}
                message={alertModal.message}
                onClose={closeAlertModal}
            />
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={confirmModal.onCancel}
            />
            <PromptModal
                isOpen={promptModal.isOpen}
                title={promptModal.title}
                message={promptModal.message}
                initialValue={promptModal.initialValue}
                inputPlaceholder={promptModal.inputPlaceholder}
                onConfirm={promptModal.onConfirm}
                onCancel={promptModal.onCancel}
            />
        </>
    );
};

export default ImageManager;