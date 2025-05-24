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
    key: string;
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
    uploadMaxFileSizeMb?: number;
    uploadMaxFilesPerUpload?: number;
}

export const CONFIG_KEYS: Record<keyof AppSettings, string> = {
    defaultCopyFormat: 'config:defaultCopyFormat',
    customImagePrefix: 'config:customImagePrefix',
    enableHotlinkProtection: 'config:enableHotlinkProtection',
    allowedDomains: 'config:allowedDomains',
    siteDomain: 'config:siteDomain',
    convertToWebP: 'config:convertToWebp',
    uploadMaxFileSizeMb: 'config:uploadMaxFileSizeMb',
    uploadMaxFilesPerUpload: 'config:uploadMaxFilesPerUpload',
};

export const APP_SETTINGS_KEY = 'config:appSettings';

export const DEFAULT_MAX_FILE_SIZE_MB = 20;
export const DEFAULT_MAX_FILES_PER_UPLOAD = 10;
export const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    // 'image/svg+xml', // SVGs can contain scripts; enable with caution and ensure sanitization if used.
];
