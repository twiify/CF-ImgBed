
// For Image Metadata
export interface ImageMetadata {
  id: string;
  r2Key: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  userId?: string;
  uploadPath?: string;
}

// For API Key Records
export interface ApiKeyRecord {
  id: string;
  name: string;
  userId: string;
  keyPrefix: string;
  hashedKey: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  permissions: string[];
  status: 'active' | 'revoked';
}

export interface AppSettings {
  defaultCopyFormat?: string;
  customImagePrefix?: string;
  enableHotlinkProtection?: boolean;
  allowedDomains?: string[];
  siteDomain?: string;
  convertToWebP?: boolean;
}

export const CONFIG_KEYS: Record<keyof AppSettings, string> = {
  defaultCopyFormat: 'config:defaultCopyFormat',
  customImagePrefix: 'config:customImagePrefix',
  enableHotlinkProtection: 'config:enableHotlinkProtection',
  allowedDomains: 'config:allowedDomains',
  siteDomain: 'config:siteDomain',
  convertToWebP: 'config:convertToWebp',
};

export const APP_SETTINGS_KEY = 'config:appSettings';
