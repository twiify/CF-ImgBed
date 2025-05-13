import { h } from 'preact';
import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { actions } from 'astro:actions';
import { EscapeHtml } from '~/lib/utils';

import AlertModal from '~/components/admin/AlertModal';

interface AppSettings {
  defaultCopyFormat?: string;
  customImagePrefix?: string;
  enableHotlinkProtection?: boolean;
  allowedDomains?: string[];
  siteDomain?: string;
}

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
  });
  const [initialSiteDomain, setInitialSiteDomain] = useState(''); // To store initial site domain for prefix display
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // AlertModal state
  const [alertModal, setAlertModal] = useState<{isOpen: boolean; title: string; message: string;}>({ isOpen: false, title: "", message: "" });

  const showAlert = useCallback((title: string, message: string) => {
    setAlertModal({ isOpen: true, title, message });
  }, []);

  const closeAlertModal = useCallback(() => {
    setAlertModal(s => ({ ...s, isOpen: false }));
  }, []);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await actions.getAppSettings({});
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
      const result = await actions.updateAppSettings(settingsToSave);
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
        <section class="bg-background text-text border p-6 rounded-lg shadow-md">
          <h2 class="text-xl font-semibold mb-4">上传与链接设置</h2>
          
          <div>
            <label for="default-copy-format" class="block text-sm font-medium mb-1">默认复制格式</label>
            <select 
              id="default-copy-format" 
              name="defaultCopyFormat" 
              value={settings.defaultCopyFormat}
              onInput={handleInputChange}
              class="w-full md:w-1/2 p-2 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text"
            >
              {copyFormats.map(format => (
                <option 
                  value={format.value}
                  key={format.value}
                >
                  {format.label}
                </option>
              ))}
            </select>
            <p class="text-xs text-gray-500 mt-1">上传完成后，将自动复制此格式的链接。</p>
          </div>

          <div class="mt-6">
            <label for="custom-image-prefix" class="block text-sm font-medium mb-1">自定义图片访问前缀</label>
            <div class="flex items-center">
              <span class="text-sm text-gray-500 mr-1">{displaySiteDomain}/</span>
              <input 
                type="text" 
                id="custom-image-prefix" 
                name="customImagePrefix" 
                value={settings.customImagePrefix ?? ""}
                onInput={handleInputChange}
                placeholder="例如：img, files" 
                class="w-full md:w-1/3 p-2 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text" 
              />
              <span class="text-sm text-gray-500 ml-1">/your-image.jpg</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">设置图片访问 URL 中的路径前缀。推荐只使用字母、数字、下划线或短横线。留空使用默认值 (img)。</p>
          </div>

          <div class="mt-6">
            <label for="site-domain" class="block text-sm font-medium mb-1">自定义网站域名 (可选)</label>
            <input 
                type="text" 
                id="site-domain" 
                name="siteDomain" 
                value={settings.siteDomain ?? ""}
                onInput={handleInputChange}
                placeholder="例如：img.example.com 或 https://img.example.com" 
                class="w-full md:w-1/2 p-2 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text" 
              />
            <p class="text-xs text-gray-500 mt-1">用于生成图片的公开访问链接。如果留空，将尝试自动检测当前域名。推荐包含协议 (http/https)。</p>
          </div>
        </section>

        <section class="bg-background border p-6 rounded-lg shadow-md">
          <h2 class="text-xl font-semibold mb-4">安全设置</h2>
          
          <div class="flex items-start">
            <div class="flex items-center h-5">
              <input 
                id="enable-hotlink-protection" 
                name="enableHotlinkProtection" 
                type="checkbox" 
                checked={settings.enableHotlinkProtection}
                onChange={handleInputChange} // Use onChange for checkboxes for better accessibility and standard behavior
                class="h-4 w-4 text-text border-border rounded focus:ring-2 focus:ring-text"
              />
            </div>
            <div class="ml-3 text-sm">
              <label for="enable-hotlink-protection" class="font-medium">启用防盗链</label>
              <p class="text-xs text-gray-500">防止其他网站直接嵌入您的图片。</p>
            </div>
          </div>

          <div class={`mt-4 ${settings.enableHotlinkProtection ? '' : 'hidden'}`}>
            <label for="allowed-domains" class="block text-sm font-medium mb-1">允许的域名 (白名单)</label>
            <textarea 
              id="allowed-domains" 
              name="allowedDomains" 
              value={settings.allowedDomains ? settings.allowedDomains.join('\n') : ""}
              onInput={handleInputChange}
              class="w-full md:w-1/2 p-2 border border-border rounded-md bg-gray-100 focus:border-text focus:ring-1 focus:ring-text"
              placeholder="每行一个域名，例如：\nexample.com\nyour-blog.com"
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">允许这些域名下的网站引用图片。如果为空，则所有外部引用都会被阻止（如果启用了防盗链）。</p>
          </div>
        </section>
        
        <section class="bg-background border p-6 rounded-lg shadow-md">
          <h2 class="text-xl font-semibold mb-4">账户设置</h2>
          <div>
            <p class="text-sm mb-2">登录凭据通过环境变量配置。请参考文档设置 <code>AUTH_USERNAME</code> 和 <code>AUTH_PASSWORD</code>。</p>
          </div>
        </section>

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
