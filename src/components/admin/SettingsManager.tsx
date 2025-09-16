import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { actions } from 'astro:actions';

import AlertModal from '~/components/admin/AlertModal';
import CustomSelect from '~/components/admin/CustomSelect';
import {
    DEFAULT_MAX_FILE_SIZE_MB,
    DEFAULT_MAX_FILES_PER_UPLOAD,
    type AppSettings,
} from '~/lib/consts';

const copyFormats = [
    { value: 'url', label: 'URL (直接链接)' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'html', label: 'HTML (<img> 标签)' },
    { value: 'bbcode', label: 'BBCode ([img] 标签)' },
];

const SettingsManager: FunctionalComponent = () => {
    const [settings, setSettings] = useState<AppSettings>({
        defaultCopyFormat: 'url',
        customImagePrefix: 'img',
        enableHotlinkProtection: false,
        allowedDomains: [],
        siteDomain: '',
        convertToWebP: false,
        uploadMaxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
        uploadMaxFilesPerUpload: DEFAULT_MAX_FILES_PER_UPLOAD,
    });
    const [initialSiteDomain, setInitialSiteDomain] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // AlertModal state
    const [alertModal, setAlertModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
    }>({ isOpen: false, title: '', message: '' });

    const showAlert = useCallback((title: string, message: string) => {
        setAlertModal({ isOpen: true, title, message });
    }, []);

    const closeAlertModal = useCallback(() => {
        setAlertModal((s) => ({ ...s, isOpen: false }));
    }, []);

    const fetchSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await actions.admin.getAppSettings({});
            if (result.error) {
                throw new Error(result.error.message);
            }
            if (result.data) {
                setSettings(result.data);
                setInitialSiteDomain(result.data.siteDomain || '');
            }
        } catch (error: any) {
            showAlert('加载失败', `无法加载设置: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [showAlert]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleInputChange = (e: Event) => {
        const target = e.target as
            | HTMLInputElement
            | HTMLSelectElement
            | HTMLTextAreaElement;
        const name = target.name;

        if (name === 'allowedDomains') {
            const value = (target as HTMLTextAreaElement).value;
            setSettings((prevSettings) => ({
                ...prevSettings,
                allowedDomains: value
                    .split('\n')
                    .map((d) => d.trim())
                    .filter((d) => d.length > 0),
            }));
        } else if (target.type === 'checkbox') {
            const value = (target as HTMLInputElement).checked;
            setSettings((prevSettings) => ({
                ...prevSettings,
                [name]: value,
            }));
        } else {
            const value = target.value;
            setSettings((prevSettings) => ({
                ...prevSettings,
                [name]: value,
            }));
        }
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setIsSaving(true);

        const settingsToSave: AppSettings = {
            ...settings,
            customImagePrefix: settings.customImagePrefix?.trim() || '',
            siteDomain: settings.siteDomain?.trim() || '',
            // settings.allowedDomains should already be string[] due to handleInputChange
            allowedDomains: settings.allowedDomains || [],
            uploadMaxFileSizeMb: Number(settings.uploadMaxFileSizeMb) || 20,
            uploadMaxFilesPerUpload:
                Number(settings.uploadMaxFilesPerUpload) || 10,
        };

        try {
            const result =
                await actions.admin.updateAppSettings(settingsToSave);
            if (result.error) {
                throw new Error(result.error.message);
            }
            showAlert('保存成功', result.data?.message || '设置已成功保存！');
            // Update initialSiteDomain if siteDomain was changed
            if (settingsToSave.siteDomain !== undefined) {
                setInitialSiteDomain(settingsToSave.siteDomain);
            }
            // Update localStorage for defaultCopyFormat
            if (settingsToSave.defaultCopyFormat) {
                localStorage.setItem(
                    'defaultCopyFormat',
                    settingsToSave.defaultCopyFormat,
                );
            } else {
                localStorage.removeItem('defaultCopyFormat');
            }
        } catch (error: any) {
            showAlert('保存失败', `保存设置失败: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="card-enhanced p-8 text-center animate-pulse">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                    <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                </div>
                <p className="text-text-secondary">正在加载系统设置...</p>
            </div>
        );
    }

    const currentHostname =
        typeof window !== 'undefined' ? window.location.hostname : '';
    const displaySiteDomain =
        settings.siteDomain?.trim() ||
        initialSiteDomain.trim() ||
        currentHostname;

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-8">
                <div className="card-enhanced p-8 animate-scale-in">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-xl">upload_file</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text">上传与链接设置</h2>
                            <p className="text-sm text-text-secondary">配置文件上传和访问链接的相关参数</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                        {/* 默认复制格式 */}
                        <div className="space-y-3">
                            <label htmlFor="default-copy-format" className="flex items-center gap-2 text-sm font-medium text-text">
                                <span className="material-symbols-outlined text-base">content_copy</span>
                                默认复制格式
                            </label>
                            <CustomSelect
                                options={copyFormats}
                                value={settings.defaultCopyFormat}
                                onChange={(value) => setSettings(prev => ({ ...prev, defaultCopyFormat: value }))}
                                placeholder="请选择复制格式"
                            />
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">info</span>
                                上传完成后，将自动复制此格式的链接
                            </p>
                        </div>

                        {/* 最大文件大小 */}
                        <div className="space-y-3">
                            <label htmlFor="upload-max-file-size-mb" className="flex items-center gap-2 text-sm font-medium text-text">
                                <span className="material-symbols-outlined text-base">data_usage</span>
                                最大文件大小 (MB)
                            </label>
                            <input
                                type="number"
                                id="upload-max-file-size-mb"
                                name="uploadMaxFileSizeMb"
                                value={settings.uploadMaxFileSizeMb ?? 20}
                                onInput={handleInputChange}
                                min="1"
                                max="100"
                                className="input-enhanced w-full"
                                placeholder="20"
                            />
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">info</span>
                                设置允许上传的单个图片文件的最大体积
                            </p>
                        </div>

                        {/* 最大批量上传文件数量 */}
                        <div className="space-y-3">
                            <label htmlFor="upload-max-files-per-upload" className="flex items-center gap-2 text-sm font-medium text-text">
                                <span className="material-symbols-outlined text-base">library_add</span>
                                最大批量上传文件数量
                            </label>
                            <input
                                type="number"
                                id="upload-max-files-per-upload"
                                name="uploadMaxFilesPerUpload"
                                value={settings.uploadMaxFilesPerUpload ?? 10}
                                onInput={handleInputChange}
                                min="1"
                                max="50"
                                className="input-enhanced w-full"
                                placeholder="10"
                            />
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">info</span>
                                设置单次批量上传允许的最大文件数量
                            </p>
                        </div>
                    </div>

                    <div className="space-y-8">

                        {/* 自定义图片访问前缀 */}
                        <div className="space-y-3">
                            <label htmlFor="custom-image-prefix" className="flex items-center gap-2 text-sm font-medium text-text">
                                <span className="material-symbols-outlined text-base">link</span>
                                自定义图片访问前缀
                            </label>
                            <div className="p-4 bg-surface rounded-xl border border-border-light">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                                    <span className="text-text-secondary font-mono">{displaySiteDomain}/</span>
                                    <input
                                        type="text"
                                        id="custom-image-prefix"
                                        name="customImagePrefix"
                                        value={settings.customImagePrefix ?? ''}
                                        onInput={handleInputChange}
                                        placeholder="img"
                                        className="input-enhanced flex-1 min-w-0 text-center font-mono"
                                    />
                                    <span className="text-text-secondary font-mono">/your-image.jpg</span>
                                </div>
                            </div>
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">info</span>
                                设置图片访问 URL 中的路径前缀，推荐使用字母、数字、下划线或短横线
                            </p>
                        </div>

                        {/* 自定义网站域名 */}
                        <div className="space-y-3">
                            <label htmlFor="site-domain" className="flex items-center gap-2 text-sm font-medium text-text">
                                <span className="material-symbols-outlined text-base">public</span>
                                自定义网站域名 (可选)
                            </label>
                            <input
                                type="text"
                                id="site-domain"
                                name="siteDomain"
                                value={settings.siteDomain ?? ''}
                                onInput={handleInputChange}
                                placeholder="例如：img.example.com 或 https://img.example.com"
                                className="input-enhanced w-full font-mono"
                            />
                            <p className="text-xs text-text-muted flex items-center gap-2">
                                <span className="material-symbols-outlined text-xs">info</span>
                                用于生成图片的公开访问链接，留空将自动检测当前域名
                            </p>
                        </div>

                        {/* WebP 转换 */}
                        <div className="p-4 rounded-xl border border-border-light bg-gradient-subtle">
                            <div className="flex items-start gap-4">
                                <div className="flex items-center h-6">
                                    <input
                                        id="convert-to-webp"
                                        name="convertToWebP"
                                        type="checkbox"
                                        checked={settings.convertToWebP}
                                        onChange={handleInputChange}
                                        className="w-5 h-5 text-primary bg-background border-2 border-border rounded focus:ring-primary/20 focus:ring-2"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label htmlFor="convert-to-webp" className="cursor-pointer">
                                        <div className="flex items-center gap-2 font-medium text-text mb-1">
                                            <span className="material-symbols-outlined text-base">image</span>
                                            上传时转换为 WebP 格式
                                        </div>
                                        <p className="text-sm text-text-secondary">
                                            启用后，所有上传的图片将自动转换为 WebP 格式以优化大小和质量
                                        </p>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card-enhanced p-8 animate-scale-in" style={{animationDelay: '0.1s'}}>
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-xl">security</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text">安全设置</h2>
                            <p className="text-sm text-text-secondary">配置图片访问安全和防盗链保护功能</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        {/* 防盗链开关 */}
                        <div className="p-4 rounded-xl border border-border-light bg-gradient-subtle">
                            <div className="flex items-start gap-4">
                                <div className="flex items-center h-6">
                                    <input
                                        id="enable-hotlink-protection"
                                        name="enableHotlinkProtection"
                                        type="checkbox"
                                        checked={settings.enableHotlinkProtection}
                                        onChange={handleInputChange}
                                        className="w-5 h-5 text-primary bg-background border-2 border-border rounded focus:ring-primary/20 focus:ring-2"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label htmlFor="enable-hotlink-protection" className="cursor-pointer">
                                        <div className="flex items-center gap-2 font-medium text-text mb-1">
                                            <span className="material-symbols-outlined text-base">lock</span>
                                            启用防盗链保护
                                        </div>
                                        <p className="text-sm text-text-secondary">
                                            防止其他网站直接嵌入您的图片，保护您的存储流量和带宽
                                        </p>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* 允许的域名 */}
                        <div className={`transition-all duration-300 ${settings.enableHotlinkProtection ? 'opacity-100 max-h-none' : 'opacity-50 max-h-0 overflow-hidden'}`}>
                            <div className="space-y-3">
                                <label htmlFor="allowed-domains" className="flex items-center gap-2 text-sm font-medium text-text">
                                    <span className="material-symbols-outlined text-base">domain</span>
                                    允许的域名 (白名单)
                                </label>
                                <textarea
                                    id="allowed-domains"
                                    name="allowedDomains"
                                    value={settings.allowedDomains ? settings.allowedDomains.join('\n') : ''}
                                    onChange={handleInputChange}
                                    className="input-enhanced w-full h-24 resize-none font-mono"
                                    placeholder="每行一个域名，例如：&#10;example.com&#10;your-blog.com"
                                    disabled={!settings.enableHotlinkProtection}
                                />
                                <p className="text-xs text-text-muted flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs">info</span>
                                    配置允许引用本站图片的外部域名。如果留空且防盗链已启用，则会阻止所有非本站域名的图片引用
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card-enhanced p-8 animate-scale-in" style={{animationDelay: '0.2s'}}>
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-xl">manage_accounts</span>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text">账户设置</h2>
                            <p className="text-sm text-text-secondary">管理登录凭据和访问权限配置</p>
                        </div>
                    </div>

                    <div className="card-enhanced p-6 border-primary/20 bg-primary/5">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                <span className="material-symbols-outlined text-primary">info</span>
                            </div>
                            <div className="flex-1">
                                <h3 className="font-medium text-text mb-2">环境变量配置</h3>
                                <p className="text-sm text-text-secondary mb-3">
                                    登录凭据通过环境变量配置。请参考文档设置以下变量：
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-sm">key</span>
                                        <code className="text-xs font-mono bg-surface px-2 py-1 rounded border border-border-light text-text">
                                            AUTH_USERNAME
                                        </code>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-primary text-sm">lock</span>
                                        <code className="text-xs font-mono bg-surface px-2 py-1 rounded border border-border-light text-text">
                                            AUTH_PASSWORD
                                        </code>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-end animate-slide-in-up" style={{animationDelay: '0.3s'}}>
                    <button
                        type="submit"
                        className="btn-enhanced btn-primary-enhanced px-8 py-3 rounded-xl inline-flex items-center gap-2 hover:scale-105 transition-all duration-200"
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                <span>保存中</span>
                            </>
                        ) : (
                            <>
                                <span className="material-symbols-outlined">save</span>
                                <span>保存设置</span>
                            </>
                        )}
                    </button>
                </div>
            </form>

            <AlertModal
                isOpen={alertModal.isOpen}
                title={alertModal.title}
                message={alertModal.message}
                onClose={closeAlertModal}
            />
        </>
    );
};

export default SettingsManager;
