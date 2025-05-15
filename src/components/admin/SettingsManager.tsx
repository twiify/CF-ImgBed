import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { actions } from 'astro:actions';

import AlertModal from '~/components/admin/AlertModal';
import type { AppSettings } from '~/lib/consts';

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
    convertToWebP: false, // Initialize new setting
  });
  const [initialSiteDomain, setInitialSiteDomain] = useState(''); // To store initial site domain for prefix display
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // AlertModal state
  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; title: string; message: string; }>({ isOpen: false, title: "", message: "" });

  const showAlert = useCallback((title: string, message: string) => {
    setAlertModal({ isOpen: true, title, message });
  }, []);

  const closeAlertModal = useCallback(() => {
    setAlertModal(s => ({ ...s, isOpen: false }));
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
      showAlert("加载失败", `无法加载设置: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const name = target.name;

    if (name === 'allowedDomains') {
      const value = (target as HTMLTextAreaElement).value;
      setSettings(prevSettings => ({
        ...prevSettings,
        allowedDomains: value.split('\n').map(d => d.trim()).filter(d => d.length > 0),
      }));
    } else if (target.type === 'checkbox') {
      const value = (target as HTMLInputElement).checked;
      setSettings(prevSettings => ({
        ...prevSettings,
        [name]: value,
      }));
    } else {
      const value = target.value;
      setSettings(prevSettings => ({
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
    };

    try {
      const result = await actions.admin.updateAppSettings(settingsToSave);
      if (result.error) {
        throw new Error(result.error.message);
      }
      showAlert("保存成功", result.data?.message || "设置已成功保存！");
      // Update initialSiteDomain if siteDomain was changed
      if (settingsToSave.siteDomain !== undefined) {
        setInitialSiteDomain(settingsToSave.siteDomain);
      }
      // Update localStorage for defaultCopyFormat
      if (settingsToSave.defaultCopyFormat) {
        localStorage.setItem('defaultCopyFormat', settingsToSave.defaultCopyFormat);
      } else {
        localStorage.removeItem('defaultCopyFormat');
      }

    } catch (error: any) {
      showAlert("保存失败", `保存设置失败: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div class="bg-background border border-border p-6 text-center text-gray-500 rounded-lg shadow-md">加载设置中...</div>;
  }

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const displaySiteDomain = settings.siteDomain?.trim() || initialSiteDomain.trim() || currentHostname;

  return (
    <>
      <form onSubmit={handleSubmit} class="space-y-8">
        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h2 className="card-title text-xl mb-6">
              <span className="material-symbols-outlined align-bottom mr-2">upload_file</span>
              上传与链接设置
            </h2>

            {/* 默认复制格式 */}
            <div className="form-control w-full max-w-md space-y-2 mb-4">
              <label className="label">
                <span className="label-text font-medium">默认复制格式</span>
              </label>
              <select
                  id="default-copy-format"
                  name="defaultCopyFormat"
                  value={settings.defaultCopyFormat}
                  onInput={handleInputChange}
                  className="select select-bordered w-full"
              >
                {copyFormats.map((format) => (
                    <option value={format.value} key={format.value}>
                      {format.label}
                    </option>
                ))}
              </select>
              <div className="label">
                <span className="label-text-alt text-gray-500">
                  上传完成后，将自动复制此格式的链接。
                </span>
              </div>
            </div>


            {/* 自定义图片访问前缀 */}
            <div className="form-control w-full max-w-lg space-y-2 mb-4">
              <label className="label">
                <span className="label-text font-medium">自定义图片访问前缀</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">{displaySiteDomain}/</span>
                <input
                    type="text"
                    id="custom-image-prefix"
                    name="customImagePrefix"
                    value={settings.customImagePrefix ?? ""}
                    onInput={handleInputChange}
                    placeholder="例如：img, files"
                    className="input input-bordered flex-1"
                />
                <span className="text-sm text-gray-500">/your-image.jpg</span>
              </div>
              <div className="label">
                <span className="label-text-alt text-gray-500">
                  设置图片访问 URL 中的路径前缀。推荐只使用字母、数字、下划线或短横线。留空使用默认值 (img)。
                </span>
              </div>
            </div>

            {/* 自定义网站域名 */}
            <div className="form-control w-full max-w-lg space-y-2 mb-4">
              <label className="label">
                <span className="label-text font-medium">自定义网站域名 (可选)</span>
              </label>
              <input
                  type="text"
                  id="site-domain"
                  name="siteDomain"
                  value={settings.siteDomain ?? ""}
                  onInput={handleInputChange}
                  placeholder="例如：img.example.com 或 https://img.example.com"
                  className="input input-bordered w-full"
              />
              <div className="label">
                <span className="label-text-alt text-gray-500">
                  用于生成图片的公开访问链接。如果留空，将尝试自动检测当前域名。推荐包含协议 (http/https)。
                </span>
              </div>
            </div>

            {/* WebP 转换 */}
            <div className="form-control">
              <div className="flex items-center gap-4">
                <input
                    id="convert-to-webp"
                    name="convertToWebP"
                    type="checkbox"
                    checked={settings.convertToWebP}
                    onChange={handleInputChange}
                    className="checkbox checkbox-primary"
                />
                <div className="flex-1">
                  <label htmlFor="convert-to-webp" className="cursor-pointer">
                    <div className="font-medium">上传时转换为 WebP 格式</div>
                    <div className="text-sm text-gray-500 mt-1">
                      启用后，所有上传的图片（支持的格式）将自动转换为 WebP 格式以优化大小和质量。原始图片不会保留。
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h2 className="card-title text-xl mb-6">
              <span className="material-symbols-outlined align-bottom mr-2">lock</span>
              安全设置
            </h2>

            {/* 防盗链开关 */}
            <div className="form-control">
              <div className="flex items-center gap-4">
                <input
                    id="enable-hotlink-protection"
                    name="enableHotlinkProtection"
                    type="checkbox"
                    checked={settings.enableHotlinkProtection}
                    onChange={handleInputChange}
                    className="checkbox checkbox-primary"
                />
                <div className="flex-1">
                  <label htmlFor="enable-hotlink-protection" className="cursor-pointer">
                    <div className="font-medium">启用防盗链</div>
                    <div className="text-sm text-gray-500 mt-1">
                      防止其他网站直接嵌入您的图片。
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* 允许的域名 */}
            <div className={`${settings.enableHotlinkProtection ? "" : "hidden"}`}>
              <div className="form-control w-full max-w-lg space-y-2 flex flex-col">
                <label className="label">
                  <span className="label-text font-medium mt-4">允许的域名 (白名单)</span>
                </label>
                <textarea
                    id="allowed-domains"
                    name="allowedDomains"
                    value={settings.allowedDomains ? settings.allowedDomains.join("\n") : ""}
                    onChange={handleInputChange}
                    className="textarea textarea-bordered h-24 mt-2"
                    placeholder="每行一个域名，例如：\nexample.com\nyour-blog.com"
                ></textarea>
              </div>
              <div className="label mt-2">
                  <span className="label-text-alt text-gray-500">
                    配置允许引用本站图片的外部域名（白名单）。如果留空，且防盗链已启用，则会阻止所有非本站域名的图片引用。
                  </span>
              </div>
            </div>
          </div>
        </section>

        <div className="card bg-base-100 shadow-lg">
          <div className="card-body">
            <h2 className="card-title text-xl mb-4">
              <span className="material-symbols-outlined align-bottom mr-2">manage_accounts</span>
              账户设置
            </h2>
            <div className="alert">
              <span className="material-symbols-outlined align-bottom mr-2">info</span>
              <div>
                <p className="text-sm">
                  登录凭据通过环境变量配置。请参考文档设置
                  <code className="bg-base-300 text-base-content px-1 py-0.5 rounded mx-1 font-mono text-xs">
                    AUTH_USERNAME
                  </code> 和
                  <code className="bg-base-300 text-base-content px-1 py-0.5 rounded mx-1 font-mono text-xs">
                    AUTH_PASSWORD
                  </code>。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-8 flex justify-end">
          <button
            type="submit"
            class="bg-text text-background py-2 px-6 rounded-md hover:opacity-90 transition-opacity"
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存设置'}
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
