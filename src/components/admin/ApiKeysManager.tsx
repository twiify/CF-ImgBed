import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { actions } from 'astro:actions';
import { escapeHtml } from '~/lib/utils';

import AlertModal from '~/components/admin/AlertModal';
import ConfirmModal from '~/components/admin/ConfirmModal';
import PromptModal from '~/components/admin/PromptModal';

// Define the structure for API keys
interface DisplayApiKey {
    id: string;
    name: string;
    key: string;
    createdAt: string;
    lastUsedAt?: string;
    permissions: string[];
}

const ApiKeysManager: FunctionalComponent = () => {
    const [apiKeys, setApiKeys] = useState<DisplayApiKey[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [alertModal, setAlertModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        inputValue?: string;
        inputReadOnly?: boolean;
        primaryButtonText?: string;
        onPrimaryAction?: () => void;
        secondaryButtonText?: string;
        onSecondaryAction?: () => void;
    }>({ isOpen: false, title: '', message: '' });
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        onCancel: () => void;
        confirmText?: string;
        cancelText?: string;
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
        confirmText?: string;
        cancelText?: string;
    }>({
        isOpen: false,
        title: '',
        message: '',
        initialValue: '',
        inputPlaceholder: '例如：My Test Key',
        onConfirm: () => {},
        onCancel: () => {},
    });

    // apiKeyToRevoke state is kept for now, primarily for the finally block reset,
    // but the core logic will use the passed parameter.
    const [apiKeyToRevoke, setApiKeyToRevoke] = useState<DisplayApiKey | null>(
        null,
    );

    const showAlert = useCallback(
        (
            title: string,
            message: string,
            details?: {
                inputValue?: string;
                inputReadOnly?: boolean;
                primaryButtonText?: string;
                onPrimaryAction?: () => void;
                secondaryButtonText?: string;
                onSecondaryAction?: () => void;
            },
        ) => {
            setAlertModal({
                isOpen: true,
                title,
                message,
                inputValue: details?.inputValue,
                inputReadOnly: details?.inputReadOnly,
                primaryButtonText: details?.primaryButtonText,
                onPrimaryAction: details?.onPrimaryAction,
                secondaryButtonText: details?.secondaryButtonText,
                onSecondaryAction: details?.onSecondaryAction,
            });
        },
        [],
    );

    const closeAlertModal = useCallback(() => {
        setAlertModal((s) => ({ ...s, isOpen: false }));
    }, []);

    const showConfirm = useCallback(
        (
            title: string,
            message: string,
            confirmBtnText: string = '确认',
            cancelBtnText: string = '取消',
        ): Promise<boolean> => {
            return new Promise((resolve) => {
                const handleModalConfirm = () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    resolve(true);
                };
                const handleModalCancel = () => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    resolve(false);
                };
                setConfirmModal({
                    isOpen: true,
                    title,
                    message,
                    confirmText: confirmBtnText,
                    cancelText: cancelBtnText,
                    onConfirm: handleModalConfirm,
                    onCancel: handleModalCancel,
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
            placeholder: string = '例如：My Test Key',
            confirmBtnText: string = '生成',
            cancelBtnText: string = '取消',
        ): Promise<string | null> => {
            return new Promise((resolve) => {
                setPromptModal({
                    isOpen: true,
                    title,
                    message,
                    initialValue,
                    inputPlaceholder: placeholder,
                    confirmText: confirmBtnText,
                    cancelText: cancelBtnText,
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

    const sortedApiKeys = useMemo(() => {
        return [...apiKeys].sort(
            (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
        );
    }, [apiKeys]);

    const fetchApiKeys = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const result = await actions.admin.listApiKeys({});
            if (result.error) {
                throw new Error(result.error.message);
            }
            const validKeys = (result.data || []).filter(
                (key) => typeof key.id === 'string',
            );
            setApiKeys(validKeys as DisplayApiKey[]);
        } catch (error: any) {
            console.error('Failed to fetch API keys:', error);
            setErrorMessage(`无法加载 API Keys: ${error.message}`);
            showAlert('加载错误', `无法加载 API Keys: ${error.message}`);
            setApiKeys([]);
        } finally {
            setIsLoading(false);
        }
    }, [showAlert]);

    useEffect(() => {
        fetchApiKeys();
    }, [fetchApiKeys]);

    const handleGenerateKey = useCallback(
        async (name: string) => {
            setIsProcessing(true);
            setErrorMessage(null);
            try {
                const result = await actions.admin.createApiKey({
                    name: name.trim(),
                });
                if (result.error) {
                    throw new Error(result.error.message);
                }
                if (result.data?.apiKey) {
                    const newApiKey = result.data.apiKey;
                    showAlert('API Key 已生成', '请妥善保管您的 API Key。', {
                        inputValue: newApiKey,
                        inputReadOnly: true,
                        primaryButtonText: '复制并关闭',
                        onPrimaryAction: () => {
                            navigator.clipboard
                                .writeText(newApiKey)
                                .then(() => {
                                    showAlert(
                                        '已复制',
                                        'API Key 已复制到剪贴板！',
                                    );
                                })
                                .catch((err) => {
                                    console.error('无法复制 API Key: ', err);
                                    showAlert(
                                        '复制失败',
                                        '无法自动复制，请手动复制。',
                                    );
                                });
                            closeAlertModal();
                            fetchApiKeys();
                        },
                        secondaryButtonText: '关闭',
                        onSecondaryAction: () => {
                            closeAlertModal();
                            fetchApiKeys();
                        },
                    });
                } else {
                    throw new Error('从 createApiKey 操作未返回 API Key。');
                }
            } catch (error: any) {
                console.error('生成 API Key 失败:', error);
                showAlert('生成失败', `生成 API Key 失败: ${error.message}`);
            } finally {
                setIsProcessing(false);
            }
        },
        [showAlert, closeAlertModal, fetchApiKeys],
    );

    const handleOpenGenerateModal = useCallback(async () => {
        const keyName = await showPrompt(
            '生成 API Key',
            '请输入新 API Key 的名称 (可选):',
            '',
            '例如：My Test Key',
        );
        if (keyName !== null) {
            handleGenerateKey(keyName);
        }
    }, [showPrompt, handleGenerateKey]);

    // Renamed from handleRevokeKey to executeRevokeAction, accepts key as parameter
    const executeRevokeAction = useCallback(
        async (keyToExecute: DisplayApiKey | null) => {
            if (!keyToExecute) {
                return;
            }

            setIsProcessing(true);
            setErrorMessage(null);
            try {
                const result = await actions.admin.revokeApiKey({
                    keyId: keyToExecute.id,
                });
                if (result.error) {
                    throw new Error(result.error.message);
                }
                showAlert(
                    '操作成功',
                    result.data?.message ||
                        `API Key "${escapeHtml(keyToExecute.name) || escapeHtml(keyToExecute.key)}" 已成功撤销。`,
                );
                fetchApiKeys();
            } catch (error: any) {
                // Keeping console.error for actual errors, removing other debug logs.
                console.error(
                    `[ApiKeysManager] Error revoking API Key ${keyToExecute?.id}:`,
                    error,
                );
                showAlert('撤销失败', `撤销 API Key 失败: ${error.message}`);
            } finally {
                setIsProcessing(false);
                setApiKeyToRevoke(null); // Resetting the component state
            }
        },
        [showAlert, fetchApiKeys],
    );

    const handleOpenRevokeModal = useCallback(
        (key: DisplayApiKey) => {
            setApiKeyToRevoke(key);
            const keyIdentifier =
                escapeHtml(key.name) ||
                (key.key
                    ? escapeHtml(key.key.split('_').slice(0, 3).join('_'))
                    : '未知Key');
            showConfirm(
                '确认撤销 API Key',
                `您确定要撤销 API Key "${keyIdentifier}" 吗？此操作不可逆。`,
                '确认撤销',
                '取消',
            ).then((confirmed) => {
                if (confirmed) {
                    executeRevokeAction(key);
                } else {
                    setApiKeyToRevoke(null);
                }
            });
        },
        [showConfirm, executeRevokeAction],
    );

    const handleCopyKey = useCallback(
        async (apiKeyToCopy: string) => {
            if (!apiKeyToCopy) {
                showAlert('复制错误', '没有可复制的 API Key。');
                return;
            }
            try {
                await navigator.clipboard.writeText(apiKeyToCopy);
                showAlert('已复制', 'API Key 已成功复制到剪贴板！');
            } catch (err) {
                console.error('无法复制 API Key: ', err);
                showAlert(
                    '复制失败',
                    '无法自动将 API Key 复制到剪贴板。请手动选择并复制。',
                );
            }
        },
        [showAlert],
    );

    let content;
    if (isLoading && apiKeys.length === 0) {
        content = (
            <div class="bg-background border border-border p-6 text-center text-gray-500 rounded-lg shadow-md">
                加载中...
            </div>
        );
    } else if (errorMessage && !alertModal.isOpen && apiKeys.length === 0) {
        // Only show this general error if no keys are loaded
        content = (
            <div class="mb-4 p-4 bg-background border border-red-500 text-red-600 rounded-md shadow-md">
                {escapeHtml(errorMessage)}
            </div>
        );
    } else if (apiKeys.length === 0 && !isLoading) {
        content = (
            <div class="text-center py-12 card shadow-md bg-base-100">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="mx-auto h-12 w-12 text-gray-400"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                    />
                </svg>
                <h3 class="mt-2 text-xl font-semibold">暂无 API Keys</h3>
                <p class="mt-1 text-sm text-base-content/80">
                    生成一个 API Key 以便通过程序访问。
                </p>
                <div class="mt-6">
                    <button
                        onClick={handleOpenGenerateModal}
                        class="btn btn-primary"
                        disabled={isProcessing || isLoading}
                    >
                        生成 API Key
                    </button>
                </div>
            </div>
        );
    } else {
        content = (
            <div class="overflow-x-auto">
                <table class="w-full min-w-full table">
                    <thead class="">
                        <tr>
                            <th class="uppercase">名称</th>
                            <th class="uppercase">Key 前缀</th>
                            <th class="uppercase">创建日期</th>
                            <th class="uppercase">最后使用</th>
                            <th class="uppercase">权限</th>
                            <th class="uppercase">操作</th>
                        </tr>
                    </thead>
                    <tbody class="">
                        {sortedApiKeys.map((key) => {
                            const displayPrefix = key.key
                                ? key.key.split('_').slice(0, 3).join('_')
                                : 'N/A';
                            return (
                                <tr key={key.id} class="">
                                    <td class="whitespace-nowrap text-sm font-medium">
                                        {escapeHtml(key.name) || '-'}
                                    </td>
                                    <td class="whitespace-nowrap text-sm text-gray-500 font-mono">
                                        {escapeHtml(displayPrefix)}...
                                    </td>
                                    <td class="whitespace-nowrap text-sm text-gray-500">
                                        {new Date(
                                            key.createdAt,
                                        ).toLocaleDateString()}
                                    </td>
                                    <td class="whitespace-nowrap text-sm text-gray-500">
                                        {key.lastUsedAt
                                            ? new Date(
                                                  key.lastUsedAt,
                                              ).toLocaleDateString()
                                            : '从未使用'}
                                    </td>
                                    <td class="whitespace-nowrap text-sm text-gray-500">
                                        {escapeHtml(key.permissions.join(', '))}
                                    </td>
                                    <td class="whitespace-nowrap text-sm font-medium">
                                        <button
                                            class="btn btn-ghost mr-4"
                                            title="复制完整的 API Key"
                                            onClick={() =>
                                                handleCopyKey(key.key)
                                            }
                                            disabled={isProcessing || isLoading}
                                        >
                                            复制
                                        </button>
                                        <button
                                            class="btn btn-error btn-active"
                                            onClick={() =>
                                                handleOpenRevokeModal(key)
                                            }
                                            disabled={isProcessing || isLoading}
                                        >
                                            撤销
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <>
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-bold">API Keys</h1>
                <button
                    onClick={handleOpenGenerateModal}
                    class="btn btn-soft btn-primary"
                    disabled={isProcessing || isLoading}
                >
                    {isLoading && apiKeys.length === 0
                        ? '加载中...'
                        : isProcessing
                          ? '处理中...'
                          : '生成新的 API Key'}
                </button>
            </header>

            {errorMessage &&
                !alertModal.isOpen &&
                apiKeys.length > 0 && ( // Show error above table if keys are loaded but an error occurred (e.g. during an action)
                    <div class="mb-4 p-4 bg-background border border-red-500 text-red-600 rounded-md shadow-md">
                        <p>{escapeHtml(errorMessage)}</p>
                    </div>
                )}

            {content}

            <AlertModal
                isOpen={alertModal.isOpen}
                title={alertModal.title}
                message={alertModal.message}
                inputValue={alertModal.inputValue}
                inputReadOnly={alertModal.inputReadOnly}
                primaryButtonText={alertModal.primaryButtonText}
                onPrimaryAction={alertModal.onPrimaryAction}
                secondaryButtonText={alertModal.secondaryButtonText}
                onSecondaryAction={alertModal.onSecondaryAction}
                onClose={closeAlertModal}
            />
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmText={confirmModal.confirmText}
                cancelText={confirmModal.cancelText}
                onConfirm={confirmModal.onConfirm}
                onCancel={confirmModal.onCancel}
            />
            <PromptModal
                isOpen={promptModal.isOpen}
                title={promptModal.title}
                message={promptModal.message}
                initialValue={promptModal.initialValue}
                inputPlaceholder={promptModal.inputPlaceholder}
                confirmText={promptModal.confirmText}
                cancelText={promptModal.cancelText}
                onConfirm={promptModal.onConfirm}
                onCancel={promptModal.onCancel}
            />
        </>
    );
};

export default ApiKeysManager;
