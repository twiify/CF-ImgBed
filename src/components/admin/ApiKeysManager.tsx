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
    const [_apiKeyToRevoke, setApiKeyToRevoke] = useState<DisplayApiKey | null>(
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
            <div className="card-enhanced p-8 text-center animate-pulse">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                </div>
                <h3 className="text-lg font-medium text-text mb-2">
                    正在加载 API Keys
                </h3>
                <p className="text-text-secondary">请稍等片刻...</p>
            </div>
        );
    } else if (errorMessage && !alertModal.isOpen && apiKeys.length === 0) {
        content = (
            <div className="card-enhanced p-6 border-error/20 bg-error/5">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-error/10 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-error">
                            error
                        </span>
                    </div>
                    <div>
                        <h3 className="font-medium text-error mb-1">
                            加载失败
                        </h3>
                        <p className="text-text-secondary text-sm">
                            {escapeHtml(errorMessage)}
                        </p>
                    </div>
                </div>
            </div>
        );
    } else if (apiKeys.length === 0 && !isLoading) {
        content = (
            <div className="card-enhanced p-12 text-center">
                <div className="w-20 h-20 bg-success/5 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <span className="material-symbols-outlined text-success text-4xl">
                        vpn_key
                    </span>
                </div>
                <h3 className="text-2xl font-bold text-text mb-3">
                    暂无 API Keys
                </h3>
                <p className="text-text-secondary mb-8 max-w-md mx-auto">
                    您还没有创建任何 API Key。生成一个 API Key
                    以便通过程序访问，支持 PicGo 等第三方工具。
                </p>
                <button
                    onClick={handleOpenGenerateModal}
                    className="btn-enhanced btn-primary-enhanced px-6 py-3 rounded-xl inline-flex items-center gap-2"
                    disabled={isProcessing || isLoading}
                >
                    <span className="material-symbols-outlined">add</span>
                    <span>生成首个 API Key</span>
                </button>
            </div>
        );
    } else {
        content = (
            <div className="card-enhanced p-0 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-full">
                        <thead className="bg-primary/5 border-b border-border-light">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    名称
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    Key 前缀
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    创建日期
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    最后使用
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    权限
                                </th>
                                <th className="px-6 py-4 text-center text-xs font-semibold text-text-secondary uppercase tracking-wider">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-light">
                            {sortedApiKeys.map((key, index) => {
                                const displayPrefix = key.key
                                    ? key.key.split('_').slice(0, 3).join('_')
                                    : 'N/A';
                                return (
                                    <tr
                                        key={key.id}
                                        className={`hover:bg-primary/5 transition-colors duration-200 animate-fade-in`}
                                        style={{
                                            animationDelay: `${index * 50}ms`,
                                        }}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                                                    <span className="material-symbols-outlined text-primary text-sm">
                                                        vpn_key
                                                    </span>
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-text">
                                                        {escapeHtml(key.name) ||
                                                            '未命名'}
                                                    </div>
                                                    <div className="text-xs text-text-secondary">
                                                        API Key
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-mono font-medium bg-surface border border-border-light text-text-secondary">
                                                {escapeHtml(displayPrefix)}...
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary">
                                            {new Date(
                                                key.createdAt,
                                            ).toLocaleDateString('zh-CN', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {key.lastUsedAt ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 bg-success rounded-full"></div>
                                                    <span className="text-sm text-text-secondary">
                                                        {new Date(
                                                            key.lastUsedAt,
                                                        ).toLocaleDateString(
                                                            'zh-CN',
                                                            {
                                                                year: 'numeric',
                                                                month: 'short',
                                                                day: 'numeric',
                                                            },
                                                        )}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 bg-warning rounded-full"></div>
                                                    <span className="text-sm text-warning">
                                                        从未使用
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-wrap gap-1">
                                                {key.permissions.map(
                                                    (permission, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                                                        >
                                                            {escapeHtml(
                                                                permission,
                                                            )}
                                                        </span>
                                                    ),
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    className="btn-enhanced btn-ghost-enhanced p-2 rounded-lg inline-flex items-center gap-1.5 text-sm hover:scale-105 transition-all duration-200"
                                                    title="复制完整的 API Key"
                                                    onClick={() =>
                                                        handleCopyKey(key.key)
                                                    }
                                                    disabled={
                                                        isProcessing ||
                                                        isLoading
                                                    }
                                                >
                                                    <span className="material-symbols-outlined text-sm">
                                                        content_copy
                                                    </span>
                                                    <span>复制</span>
                                                </button>
                                                <button
                                                    className="btn-enhanced btn-error-enhanced p-2 rounded-lg inline-flex items-center gap-1.5 text-sm hover:scale-105 transition-all duration-200"
                                                    onClick={() =>
                                                        handleOpenRevokeModal(
                                                            key,
                                                        )
                                                    }
                                                    disabled={
                                                        isProcessing ||
                                                        isLoading
                                                    }
                                                >
                                                    <span className="material-symbols-outlined text-sm">
                                                        delete
                                                    </span>
                                                    <span>撤销</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <>
            <header className="flex justify-between items-center mb-8 animate-slide-in-up">
                <div>
                    <h1 className="text-fluid-xl font-bold text-text mb-2">
                        API Keys 管理
                    </h1>
                    <p className="text-text-secondary">
                        管理您的 API 密钥，用于程序化访问和第三方工具集成
                    </p>
                </div>
                <button
                    onClick={handleOpenGenerateModal}
                    className="btn-enhanced btn-primary-enhanced px-6 py-3 rounded-xl inline-flex items-center gap-2 hover:scale-105 transition-all duration-200"
                    disabled={isProcessing || isLoading}
                >
                    {isLoading && apiKeys.length === 0 ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>加载中</span>
                        </>
                    ) : isProcessing ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>处理中</span>
                        </>
                    ) : (
                        <>
                            <span className="material-symbols-outlined">
                                add
                            </span>
                            <span>生成新的 API Key</span>
                        </>
                    )}
                </button>
            </header>

            {errorMessage &&
                !alertModal.isOpen &&
                apiKeys.length > 0 && ( // Show error above table if keys are loaded but an error occurred (e.g. during an action)
                    <div className="card-enhanced p-4 mb-6 border-error/20 bg-error/5 animate-slide-in-down">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-error/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                <span className="material-symbols-outlined text-error">
                                    error
                                </span>
                            </div>
                            <div>
                                <h3 className="font-medium text-error mb-1">
                                    操作失败
                                </h3>
                                <p className="text-text-secondary text-sm">
                                    {escapeHtml(errorMessage)}
                                </p>
                            </div>
                        </div>
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
