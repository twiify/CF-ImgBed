import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { actions } from 'astro:actions';
import { escapeHtml } from '~/lib/utils';
import AlertModal from './AlertModal';
import ConfirmModal from './ConfirmModal';
import PromptModal from './PromptModal';
import type { AppSettings, ImageMetadata } from '~/lib/consts';

// --- Utility Functions ---
function formatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- Component ---
const ImageManager: FunctionalComponent = () => {
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [currentDirectoryPath, setCurrentDirectoryPath] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [directories, setDirectories] = useState<string[]>([]);
    const [currentDirectoryTotalSize, setCurrentDirectoryTotalSize] = useState<
        number | undefined
    >(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedItems, setSelectedItems] = useState<
        Map<string, 'image' | 'directory'>
    >(new Map());

    // Modal States
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
        onConfirm: (value: string) => void;
        onCancel: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        initialValue: '',
        onConfirm: () => {},
        onCancel: () => {},
    });

    // --- Modal Helper Functions ---
    const showAlert = useCallback((title: string, message: string) => {
        setAlertModal({ isOpen: true, title, message });
    }, []);

    const closeAlertModal = useCallback(() => {
        setAlertModal({ isOpen: false, title: '', message: '' });
    }, []);

    const showConfirm = useCallback(
        (title: string, message: string): Promise<boolean> => {
            return new Promise((resolve) => {
                setConfirmModal({
                    isOpen: true,
                    title,
                    message,
                    onConfirm: () => {
                        setConfirmModal((s) => ({ ...s, isOpen: false }));
                        resolve(true);
                    },
                    onCancel: () => {
                        setConfirmModal((s) => ({ ...s, isOpen: false }));
                        resolve(false);
                    },
                });
            });
        },
        [],
    );

    const showPrompt = useCallback(
        (
            title: string,
            message: string,
            initialValue: string = '',
            inputPlaceholder?: string,
        ): Promise<string | null> => {
            return new Promise((resolve) => {
                setPromptModal({
                    isOpen: true,
                    title,
                    message,
                    initialValue,
                    inputPlaceholder,
                    onConfirm: (value: string) => {
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

    const imageAccessPrefix = useMemo(
        () =>
            appSettings?.customImagePrefix?.trim().replace(/^\/+|\/+$/g, '') ||
            'img',
        [appSettings],
    );
    const selectedImageIds = useMemo(() => {
        const ids: string[] = [];
        selectedItems.forEach((type, id) => {
            if (type === 'image') ids.push(id);
        });
        return ids;
    }, [selectedItems]);
    const hasSelectedImages = useMemo(
        () => selectedImageIds.length > 0,
        [selectedImageIds],
    );
    const totalSelectedCount = useMemo(
        () => selectedItems.size,
        [selectedItems],
    );

    const fetchImageSettings = useCallback(async () => {
        /* ... as before ... */
        try {
            const { data, error } = await actions.admin.getAppSettings({});
            if (error) {
                setAppSettings({ customImagePrefix: 'img' });
                return;
            }
            setAppSettings(data ?? { customImagePrefix: 'img' });
        } catch (e) {
            setAppSettings({ customImagePrefix: 'img' });
        }
    }, []);

    const fetchDirectoryContents = useCallback(
        async (path: string) => {
            /* ... as before, ensure appSettings check ... */
            setCurrentDirectoryPath(path);
            setIsLoading(true);
            setErrorMessage(null);
            setSelectedItems(new Map());
            let currentSettings = appSettings;
            if (!currentSettings) {
                try {
                    const { data, error } = await actions.admin.getAppSettings(
                        {},
                    );
                    if (error) throw error;
                    currentSettings = data ?? { customImagePrefix: 'img' };
                    setAppSettings(currentSettings);
                } catch (e) {
                    currentSettings = { customImagePrefix: 'img' };
                    setAppSettings(currentSettings);
                }
            }
            try {
                const { data, error } =
                    await actions.image.listDirectoryContents({ path });
                if (error)
                    throw new Error(
                        error.message || `Failed to list directory contents`,
                    );
                if (data) {
                    setImages(data.images as ImageMetadata[]);
                    setDirectories(data.directories);
                    setCurrentDirectoryTotalSize(
                        data.currentDirectoryTotalSize,
                    );
                } else {
                    setImages([]);
                    setDirectories([]);
                    setCurrentDirectoryTotalSize(undefined);
                }
            } catch (error: any) {
                setErrorMessage(`无法加载内容: ${error.message || '未知错误'}`);
                setImages([]);
                setDirectories([]);
                setCurrentDirectoryTotalSize(undefined);
            } finally {
                setIsLoading(false);
            }
        },
        [appSettings],
    );

    useEffect(() => {
        setIsLoading(true);
        fetchImageSettings();
    }, [fetchImageSettings]);
    useEffect(() => {
        if (appSettings) fetchDirectoryContents('');
    }, [appSettings, fetchDirectoryContents]);

    const deleteItems = useCallback(
        async (idsToDelete: string[], isSingleDelete: boolean) => {
            /* ... uses showAlert & showConfirm ... */
            if (idsToDelete.length === 0) return;
            const confirmed = await showConfirm(
                '确认删除',
                isSingleDelete
                    ? `确定要删除这张图片吗？此操作不可逆。`
                    : `确定要删除选中的 ${idsToDelete.length} 张图片吗？此操作不可逆。`,
            );
            if (!confirmed) return;
            setIsProcessing(true);
            let opError = null;
            try {
                const { data, error } = await actions.image.deleteImagesAction({
                    imageIds: idsToDelete,
                });
                if (error) {
                    opError = error.message || '删除失败';
                    showAlert('删除失败', opError);
                }
                if (data) {
                    showAlert(
                        '操作完成',
                        data.message || '图片删除操作已完成。',
                    );
                    if (data.results?.failed?.length)
                        showAlert(
                            '部分失败',
                            `部分图片删除失败: ${data.results.failed.map((f) => `${f.id}: ${f.reason}`).join(', ')}`,
                        );
                }
            } catch (e: any) {
                opError = e.message || '删除异常';
                showAlert('删除异常', opError);
            } finally {
                setIsProcessing(false);
            }
            if (
                !opError ||
                (opError &&
                    (await showConfirm(
                        '部分操作失败',
                        '操作中可能出现部分问题，是否仍要刷新列表？',
                    )))
            ) {
                await fetchDirectoryContents(currentDirectoryPath);
            }
        },
        [currentDirectoryPath, fetchDirectoryContents, showAlert, showConfirm],
    );

    const moveItems = useCallback(
        async (
            idsToMove: string[],
            targetDirectory: string,
            isSingleMove: boolean,
        ) => {
            /* ... uses showAlert & showConfirm ... */
            if (idsToMove.length === 0) return;
            setIsProcessing(true);
            let opError = null;
            try {
                const { data, error } = await actions.image.moveImagesAction({
                    imageIds: idsToMove,
                    targetDirectory,
                });
                if (error) {
                    opError = error.message || '移动失败';
                    showAlert('移动失败', opError);
                }
                if (data) {
                    showAlert(
                        '操作完成',
                        data.message || '图片移动操作已完成。',
                    );
                    if (data.results?.failed?.length)
                        showAlert(
                            '部分失败',
                            `部分图片移动失败: ${data.results.failed.map((f) => `${f.id}: ${f.reason}`).join(', ')}`,
                        );
                }
            } catch (e: any) {
                opError = e.message || '移动异常';
                showAlert('移动异常', opError);
            } finally {
                setIsProcessing(false);
            }
            if (
                !opError ||
                (opError &&
                    (await showConfirm(
                        '部分操作失败',
                        '操作中可能出现部分问题，是否仍要刷新列表？',
                    )))
            ) {
                await fetchDirectoryContents(currentDirectoryPath);
            }
        },
        [currentDirectoryPath, fetchDirectoryContents, showAlert, showConfirm],
    );

    const promptForDirectoryAndMove = useCallback(
        async (imageIds: string[], singleMode: boolean = false) => {
            if (imageIds.length === 0) {
                showAlert('提示', '请选择要移动的图片。');
                return;
            }
            const title = singleMode
                ? '移动图片到...'
                : `移动 ${imageIds.length} 张图片到...`;
            const message =
                "请输入目标目录相对跟目录的路径 (例如 'archiver' 或留空表示根目录):";
            const placeholder = '例如: path/to/directory';

            const targetDirectory = await showPrompt(
                title,
                message,
                currentDirectoryPath,
                placeholder,
            );

            if (targetDirectory !== null) {
                // User confirmed and didn't cancel
                const cleanedTargetDirectory = targetDirectory.trim();
                await moveItems(imageIds, cleanedTargetDirectory, singleMode);
            }
        },
        [currentDirectoryPath, moveItems, showAlert, showPrompt],
    );

    const handleSelectAllChange = (e: Event) => {
        /* ... as before ... */
        const isChecked = (e.target as HTMLInputElement).checked;
        const newSelected = new Map<string, 'image' | 'directory'>();
        if (isChecked) {
            images.forEach((img) => newSelected.set(img.id, 'image'));
            directories.forEach((dir) => newSelected.set(dir, 'directory'));
        }
        setSelectedItems(newSelected);
    };
    const handleItemCheckboxChange = (
        itemId: string,
        itemType: 'image' | 'directory',
        isChecked: boolean,
    ) => {
        const newSelectedMap = new Map(selectedItems);
        if (isChecked) newSelectedMap.set(itemId, itemType);
        else newSelectedMap.delete(itemId);
        setSelectedItems(newSelectedMap);
    };
    const allCurrentlySelected = useMemo(() => {
        if (images.length === 0 && directories.length === 0) return false;
        return [...images.map((i) => i.id), ...directories].every((key) =>
            selectedItems.has(key),
        );
    }, [images, directories, selectedItems]);

    let content;

    if (isLoading && !appSettings && !errorMessage && !isProcessing) {
        content = (
            <div class="bg-background border p-6 text-center text-gray-500 rounded-lg shadow-md">
                正在初始化...
            </div>
        );
    } else if (errorMessage) {
        content = (
            <div class="bg-background border border-red-500 p-6 text-center text-red-600 rounded-lg shadow-md">
                {escapeHtml(errorMessage)}
            </div>
        );
    } else if (
        isLoading &&
        images.length === 0 &&
        directories.length === 0 &&
        !errorMessage &&
        !isProcessing
    ) {
        content = (
            <div class="bg-background border p-6 text-center text-gray-500 rounded-lg shadow-md">
                正在加载{' '}
                <strong>{escapeHtml(currentDirectoryPath || '根目录')}</strong>{' '}
                中的内容...
            </div>
        );
    } else if (
        !isLoading &&
        images.length === 0 &&
        directories.length === 0 &&
        currentDirectoryPath === '' &&
        !errorMessage &&
        !isProcessing
    ) {
        content = (
            <div class="text-center py-12 card mt-4 shadow-md">
                <svg
                    class="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                >
                    <path
                        vector-effect="non-scaling-stroke"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    ></path>
                </svg>
                <h3 class="mt-2 text-xl font-semibold">暂无图片</h3>
                <p class="mt-1 text-sm text-gray-500">
                    开始上传你的第一张图片吧！
                </p>
                <div class="mt-6">
                    <a href="/" class="btn btn-primary">
                        前往上传
                    </a>
                </div>
            </div>
        );
    } else {
        content = (
            <div class="bg-background card shadow-md">
                {(isLoading || isProcessing) &&
                    (images.length > 0 ||
                        directories.length > 0 ||
                        currentDirectoryPath !== '') && (
                        <p class="p-6 text-center text-gray-500">
                            {isProcessing
                                ? '正在处理操作...'
                                : `正在加载 ${escapeHtml(currentDirectoryPath || '根目录')} 中的内容...`}
                        </p>
                    )}
                {!isLoading && !isProcessing && (
                    <>
                        <div class="p-4 border-b border-border text-sm flex items-center space-x-1 flex-wrap">
                            <a
                                href="#"
                                class="hover:underline text-indigo-600"
                                onClick={(e) => {
                                    e.preventDefault();
                                    fetchDirectoryContents('');
                                }}
                            >
                                根目录
                            </a>
                            {currentDirectoryPath
                                .split('/')
                                .filter((p) => p)
                                .map((segment, index, arr) => (
                                    <>
                                        <span class="text-gray-500 mx-1">
                                            /
                                        </span>
                                        {index === arr.length - 1 ? (
                                            <span class="text-gray-700 font-medium">
                                                {escapeHtml(segment)}
                                            </span>
                                        ) : (
                                            <a
                                                href="#"
                                                class="hover:underline text-indigo-600"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    fetchDirectoryContents(
                                                        arr
                                                            .slice(0, index + 1)
                                                            .join('/'),
                                                    );
                                                }}
                                            >
                                                {escapeHtml(segment)}
                                            </a>
                                        )}
                                    </>
                                ))}
                        </div>
                        {typeof currentDirectoryTotalSize === 'number' && (
                            <div class="p-4 text-sm text-gray-600">
                                图片总大小:{' '}
                                {formatBytes(currentDirectoryTotalSize)}
                            </div>
                        )}
                        <div class="overflow-x-auto card shadow-md">
                            {images.length === 0 &&
                                directories.length === 0 &&
                                currentDirectoryPath !== '' && (
                                    <p class="p-6 text-center text-gray-500">
                                        此目录为空。
                                    </p>
                                )}
                            {(images.length > 0 || directories.length > 0) && (
                                <table class="min-w-full w-full table">
                                    {/* Table Head and Body as before */}
                                    <thead class="border-b">
                                        <tr>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                                                <input
                                                    type="checkbox"
                                                    class="checkbox checkbox-primary"
                                                    onChange={
                                                        handleSelectAllChange
                                                    }
                                                    checked={
                                                        allCurrentlySelected
                                                    }
                                                />
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                                                预览
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                                                名称
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                                                ID / 类型
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                                                大小
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
                                                上传日期
                                            </th>
                                            <th class="text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                                                操作
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody class="">
                                        {directories.map((dirName) => (
                                            <tr
                                                class="hover:bg-gray-100 cursor-pointer directory-row"
                                                key={
                                                    currentDirectoryPath
                                                        ? `${currentDirectoryPath}/${dirName}`
                                                        : dirName
                                                }
                                                onClick={(e) => {
                                                    if (
                                                        (
                                                            e.target as HTMLElement
                                                        ).tagName !== 'INPUT'
                                                    )
                                                        fetchDirectoryContents(
                                                            currentDirectoryPath
                                                                ? `${currentDirectoryPath}/${dirName}`
                                                                : dirName,
                                                        );
                                                }}
                                            >
                                                <td class="whitespace-nowrap">
                                                    <input
                                                        type="checkbox"
                                                        class="item-checkbox directory-checkbox checkbox checkbox-primary"
                                                        checked={selectedItems.has(
                                                            dirName,
                                                        )}
                                                        onChange={(e) =>
                                                            handleItemCheckboxChange(
                                                                dirName,
                                                                'directory',
                                                                (
                                                                    e.target as HTMLInputElement
                                                                ).checked,
                                                            )
                                                        }
                                                    />
                                                </td>
                                                <td class="whitespace-nowrap">
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                        class="w-10 h-10 text-yellow-500"
                                                    >
                                                        <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.5a3 3 0 013-3h15a3 3 0 013 3V12a.75.75 0 01-1.5 0v-1.5a1.5 1.5 0 00-1.5-1.5h-15a1.5 1.5 0 00-1.5 1.5v6.75a1.5 1.5 0 001.5 1.5h15a1.5 1.5 0 001.5-1.5V18a.75.75 0 011.5 0v.75a3 3 0 01-3 3h-15a3 3 0 01-3-3v-4.5z" />
                                                    </svg>
                                                </td>
                                                <td
                                                    class="text-sm font-medium text-indigo-600 whitespace-nowrap"
                                                    colSpan={3}
                                                >
                                                    {escapeHtml(dirName)}
                                                </td>
                                                <td class="text-sm text-gray-500 whitespace-nowrap hidden md:table-cell">
                                                    目录
                                                </td>
                                                <td class="text-sm font-medium whitespace-nowrap"></td>
                                            </tr>
                                        ))}
                                        {images.map((image) => {
                                            const ext = image.fileName.includes(
                                                '.',
                                            )
                                                ? `.${image.fileName.split('.').pop()}`
                                                : '';
                                            const url = `/${imageAccessPrefix}/${image.id}${ext}`;
                                            return (
                                                <tr
                                                    class="image-row hover:bg-gray-100"
                                                    key={image.id}
                                                >
                                                    <td class="whitespace-nowrap">
                                                        <input
                                                            type="checkbox"
                                                            class="item-checkbox image-checkbox checkbox checkbox-primary"
                                                            checked={selectedItems.has(
                                                                image.id,
                                                            )}
                                                            onChange={(e) =>
                                                                handleItemCheckboxChange(
                                                                    image.id,
                                                                    'image',
                                                                    (
                                                                        e.target as HTMLInputElement
                                                                    ).checked,
                                                                )
                                                            }
                                                        />
                                                    </td>
                                                    <td class="whitespace-nowrap">
                                                        <img
                                                            src={escapeHtml(
                                                                url,
                                                            )}
                                                            alt={escapeHtml(
                                                                image.fileName,
                                                            )}
                                                            class="h-12 w-12 object-cover rounded"
                                                            loading="lazy"
                                                        />
                                                    </td>
                                                    <td
                                                        class="text-sm font-medium whitespace-nowrap"
                                                        title={escapeHtml(
                                                            image.fileName,
                                                        )}
                                                    >
                                                        <span class="block max-w-[120px] sm:max-w-[150px] truncate">
                                                            {escapeHtml(
                                                                image.fileName,
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td
                                                        class="text-sm text-gray-500 whitespace-nowrap hidden sm:table-cell"
                                                        title={escapeHtml(
                                                            image.r2Key,
                                                        )}
                                                    >
                                                        <span class="block max-w-[100px] truncate">
                                                            {escapeHtml(
                                                                image.id,
                                                            )}
                                                        </span>
                                                    </td>
                                                    <td class="text-sm text-gray-500 whitespace-nowrap">
                                                        {formatBytes(
                                                            image.size,
                                                        )}
                                                    </td>
                                                    <td class="text-sm text-gray-500 whitespace-nowrap hidden md:table-cell">
                                                        {new Date(
                                                            image.uploadedAt,
                                                        ).toLocaleDateString()}
                                                    </td>
                                                    <td class="text-sm font-medium whitespace-nowrap">
                                                        <div class="flex space-x-1 sm:space-x-2">
                                                            <button
                                                                class="btn"
                                                                onClick={() =>
                                                                    window.open(
                                                                        url,
                                                                        '_blank',
                                                                    )
                                                                }
                                                            >
                                                                查看
                                                            </button>
                                                            <button
                                                                class="btn btn-info"
                                                                onClick={() =>
                                                                    promptForDirectoryAndMove(
                                                                        [
                                                                            image.id,
                                                                        ],
                                                                        true,
                                                                    )
                                                                }
                                                            >
                                                                移动
                                                            </button>
                                                            <button
                                                                class="btn btn-error"
                                                                onClick={() =>
                                                                    deleteItems(
                                                                        [
                                                                            image.id,
                                                                        ],
                                                                        true,
                                                                    )
                                                                }
                                                            >
                                                                删除
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {(images.length > 0 || directories.length > 0) && (
                            <div class="p-4 flex flex-col sm:flex-row justify-between items-center border-t border-border mt-0">
                                <div class="text-sm text-gray-600 mb-2 sm:mb-0">
                                    选中 {totalSelectedCount} 项
                                </div>
                                <div class="space-x-2">
                                    <button
                                        class="btn btn-info"
                                        disabled={!hasSelectedImages}
                                        onClick={() =>
                                            promptForDirectoryAndMove(
                                                selectedImageIds,
                                                false,
                                            )
                                        }
                                        title="批量移动选中的图片"
                                    >
                                        批量移动
                                    </button>
                                    <button
                                        class="btn btn-error"
                                        disabled={!hasSelectedImages}
                                        onClick={() =>
                                            deleteItems(selectedImageIds, false)
                                        }
                                        title="批量删除选中的图片"
                                    >
                                        批量删除
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
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
