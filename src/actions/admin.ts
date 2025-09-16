import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { customAlphabet } from 'nanoid';

import { simpleHash } from '~/lib/utils';
import type { ApiKeyRecord, AppSettings } from '~/lib/consts';
import {
    APP_SETTINGS_KEY,
    DEFAULT_MAX_FILES_PER_UPLOAD,
    DEFAULT_MAX_FILE_SIZE_MB,
} from '~/lib/consts';

/**
 * Sanitizes a string to be used as an image prefix.
 * Allows alphanumeric characters, hyphens, and underscores.
 * Removes leading/trailing slashes and whitespace. Ensures no slashes within.
 */
function sanitizeImagePrefix(prefix?: string): string {
    if (!prefix || typeof prefix !== 'string') {
        return '';
    }
    // Trim, remove leading/trailing slashes
    let sanePrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
    // Allow only alphanumeric, hyphen, underscore. Remove any slashes.
    sanePrefix = sanePrefix.replace(/[^a-zA-Z0-9_-]/g, '');
    return sanePrefix;
}

/**
 * Validates if a string is a plausible hostname.
 * This is a basic check and might not cover all edge cases of valid hostnames
 * but aims to prevent common injection patterns.
 */
function isValidHostname(hostname?: string): boolean {
    if (!hostname || typeof hostname !== 'string' || hostname.length > 253) {
        return false;
    }
    if (hostname.includes('://')) return false;

    // Using a simpler regex that's common for basic validation, but may not be fully RFC compliant.
    // This one prevents leading/trailing hyphens in segments and ensures TLD presence.
    const basicHostnamePattern =
        /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}$/;
    if (!basicHostnamePattern.test(hostname)) {
        return false;
    }
    // Prevent path traversal or other odd characters that might slip through regex
    if (
        hostname.includes('/') ||
        hostname.includes(':') ||
        hostname.includes('?') ||
        hostname.includes('#') ||
        hostname.includes('@')
    ) {
        return false;
    }
    return true;
}

export const admin = {
    getDashboardStats: defineAction({
        handler: async (_, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV namespace not found.',
                });
            try {
                const imageListResult = await IMGBED_KV.list({
                    prefix: 'image:',
                });
                const apiKeyListResult = await IMGBED_KV.list({
                    prefix: 'apikey_record:',
                });
                let activeApiKeyCount = 0;
                interface ApiKeyListMetadata {
                    status?: 'active' | 'revoked';
                }
                for (const key of apiKeyListResult.keys) {
                    const metadata = key.metadata as
                        | ApiKeyListMetadata
                        | undefined
                        | null;
                    if (metadata?.status === 'active') activeApiKeyCount++;
                }
                return {
                    totalImageCount: imageListResult.keys.length,
                    activeApiKeyCount,
                };
            } catch (e: any) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to retrieve dashboard statistics: ${e.message || e}`,
                });
            }
        },
    }),

    listApiKeys: defineAction({
        handler: async (_, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });
            try {
                const listResult = await IMGBED_KV.list({
                    prefix: 'apikey_record:',
                });
                const userApiKeys: Partial<ApiKeyRecord>[] = [];
                for (const kvKey of listResult.keys) {
                    const recordString = await (IMGBED_KV as any).get(
                        kvKey.name,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (recordString) {
                        try {
                            const record = JSON.parse(
                                recordString,
                            ) as ApiKeyRecord;
                            if (
                                record.userId === user.userId &&
                                record.status === 'active'
                            ) {
                                userApiKeys.push({
                                    id: record.id,
                                    name: record.name,
                                    key: record.key,
                                    createdAt: record.createdAt,
                                    lastUsedAt: record.lastUsedAt,
                                    permissions: record.permissions,
                                });
                            }
                        } catch (parseError) {
                            console.error(
                                `Action listApiKeys: Failed to parse API key record ${kvKey.name}:`,
                                parseError,
                            );
                        }
                    }
                }
                return userApiKeys;
            } catch (e: any) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to retrieve API keys: ${e.message || e}`,
                });
            }
        },
    }),

    createApiKey: defineAction({
        input: z.object({
            name: z.string().optional(),
            permissions: z.array(z.string()).optional(),
        }),
        handler: async (input, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });

            // 定义一个不包含 '_' 的字符集用于生成 ID
            const alphabet =
                '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const generateSecureId = customAlphabet(alphabet);

            const keyName =
                input.name?.trim() || `API Key ${generateSecureId(5)}`;
            const permissions = input.permissions || ['upload'];
            const keyId = generateSecureId(16);
            const publicIdPart = generateSecureId(12);
            const secretKeyPart = generateSecureId(32);
            const keyPrefix = `imgbed_sk_${publicIdPart}`;
            const fullApiKey = `${keyPrefix}_${secretKeyPart}`;
            const hashedFullApiKey = await simpleHash(fullApiKey);
            const newApiKeyRecord: ApiKeyRecord = {
                id: keyId,
                name: keyName,
                userId: user.userId,
                key: fullApiKey,
                hashedKey: hashedFullApiKey,
                createdAt: new Date().toISOString(),
                permissions,
                status: 'active',
            };
            try {
                await IMGBED_KV.put(
                    `apikey_record:${keyId}`,
                    JSON.stringify(newApiKeyRecord),
                    {
                        metadata: {
                            status: newApiKeyRecord.status,
                            userId: newApiKeyRecord.userId,
                        },
                    },
                );
                await IMGBED_KV.put(`apikey_public_id:${publicIdPart}`, keyId);
                return {
                    message:
                        'API Key generated successfully. Store it securely, it will not be shown again.',
                    apiKey: fullApiKey,
                    record: {
                        id: newApiKeyRecord.id,
                        name: newApiKeyRecord.name,
                        key: newApiKeyRecord.key,
                        createdAt: newApiKeyRecord.createdAt,
                        permissions: newApiKeyRecord.permissions,
                        status: newApiKeyRecord.status,
                    },
                };
            } catch (e: any) {
                try {
                    await IMGBED_KV.delete(`apikey_record:${keyId}`);
                    await IMGBED_KV.delete(`apikey_public_id:${publicIdPart}`);
                } catch (cleanupError) {
                    console.error(
                        'Failed to cleanup API key artifacts after an error:',
                        cleanupError,
                    );
                }
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to generate API key: ${e.message || e}`,
                });
            }
        },
    }),

    revokeApiKey: defineAction({
        input: z.object({ keyId: z.string() }),
        handler: async ({ keyId }, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });
            if (!keyId)
                throw new ActionError({
                    code: 'BAD_REQUEST',
                    message: 'Missing keyId',
                });
            try {
                const recordKey = `apikey_record:${keyId}`;
                const recordString = await (IMGBED_KV as any).get(recordKey, {
                    type: 'text',
                    consistency: 'strong',
                });
                if (!recordString)
                    throw new ActionError({
                        code: 'NOT_FOUND',
                        message: 'API Key not found',
                    });

                const record = JSON.parse(recordString) as ApiKeyRecord;
                if (record.userId !== user.userId) {
                    throw new ActionError({
                        code: 'FORBIDDEN',
                        message: 'Forbidden',
                    });
                }
                const prefixParts = record.key.split('_');
                let publicIdPartToDelete: string | null = null;
                if (
                    prefixParts.length === 4 &&
                    prefixParts[0] === 'imgbed' &&
                    prefixParts[1] === 'sk'
                ) {
                    publicIdPartToDelete = prefixParts[2];
                }

                // 删除记录
                await IMGBED_KV.delete(recordKey);
                if (publicIdPartToDelete) {
                    await IMGBED_KV.delete(
                        `apikey_public_id:${publicIdPartToDelete}`,
                    );
                }

                return { message: 'API Key deleted successfully' };
            } catch (e: any) {
                if (e instanceof ActionError) throw e;
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to delete API key: ${e.message || e}`,
                });
            }
        },
    }),
    getAppSettings: defineAction({
        handler: async (_, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });
            try {
                let settings: AppSettings = {};
                const settingsStr = await IMGBED_KV.get(APP_SETTINGS_KEY, {
                    type: 'text',
                    cacheTtl: 60,
                });

                if (settingsStr) {
                    try {
                        settings = JSON.parse(settingsStr);
                    } catch (e) {
                        console.error(
                            `Failed to parse app settings from KV (${APP_SETTINGS_KEY}):`,
                            e,
                        );
                        // Fallback to old keys if parsing new key fails or if it's empty
                    }
                }

                // Ensure all AppSettings fields have default values if not present
                const defaults: AppSettings = {
                    defaultCopyFormat: 'markdown',
                    customImagePrefix: '',
                    enableHotlinkProtection: false,
                    allowedDomains: [],
                    siteDomain: '',
                    convertToWebP: false,
                    uploadMaxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
                    uploadMaxFilesPerUpload: DEFAULT_MAX_FILES_PER_UPLOAD,
                };

                return { ...defaults, ...settings };
            } catch (e: any) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to retrieve settings: ${e.message || e}`,
                });
            }
        },
    }),

    updateAppSettings: defineAction({
        input: z
            .object({
                defaultCopyFormat: z.string().optional(),
                customImagePrefix: z.string().optional(),
                enableHotlinkProtection: z.boolean().optional(),
                allowedDomains: z.array(z.string()).optional(),
                siteDomain: z.string().optional(),
                convertToWebP: z.boolean().optional(),
                uploadMaxFileSizeMb: z.number().int().min(1).optional(),
                uploadMaxFilesPerUpload: z.number().int().min(1).optional(),
            })
            .partial(),
        handler: async (newSettingsToUpdate, { locals }) => {
            const user = locals.user;
            if (!user)
                throw new ActionError({
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized',
                });
            const { IMGBED_KV } = locals.runtime.env;
            if (!IMGBED_KV)
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message:
                        'Server configuration error: KV Namespace not found.',
                });

            try {
                // 1. Get current settings
                let currentSettings: AppSettings = {};
                const settingsStr = await IMGBED_KV.get(APP_SETTINGS_KEY, {
                    type: 'text',
                    cacheTtl: 0,
                });
                if (settingsStr) {
                    try {
                        currentSettings = JSON.parse(settingsStr);
                    } catch (e) {
                        console.error(
                            `Failed to parse current app settings from KV (${APP_SETTINGS_KEY}) for update:`,
                            e,
                        );
                        // Proceed with an empty object, new settings will form the base
                    }
                }

                // Ensure defaults for any missing fields in currentSettings before merging
                const defaults: AppSettings = {
                    defaultCopyFormat: 'markdown',
                    customImagePrefix: '',
                    enableHotlinkProtection: false,
                    allowedDomains: [],
                    siteDomain: '',
                    convertToWebP: false,
                    uploadMaxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
                    uploadMaxFilesPerUpload: DEFAULT_MAX_FILES_PER_UPLOAD,
                };
                currentSettings = { ...defaults, ...currentSettings };

                // 2. Merge with new settings
                const updatedSettings: AppSettings = { ...currentSettings };

                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'defaultCopyFormat',
                    )
                ) {
                    updatedSettings.defaultCopyFormat =
                        newSettingsToUpdate.defaultCopyFormat;
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'customImagePrefix',
                    )
                ) {
                    updatedSettings.customImagePrefix = sanitizeImagePrefix(
                        newSettingsToUpdate.customImagePrefix,
                    );
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'enableHotlinkProtection',
                    )
                ) {
                    updatedSettings.enableHotlinkProtection =
                        newSettingsToUpdate.enableHotlinkProtection;
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'allowedDomains',
                    )
                ) {
                    updatedSettings.allowedDomains = (
                        newSettingsToUpdate.allowedDomains || []
                    )
                        .map((d) => String(d).trim())
                        .filter((d) => d.length > 0);
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'siteDomain',
                    )
                ) {
                    const newSiteDomain = (
                        newSettingsToUpdate.siteDomain || ''
                    ).trim();
                    if (
                        newSiteDomain === '' ||
                        isValidHostname(newSiteDomain)
                    ) {
                        updatedSettings.siteDomain = newSiteDomain;
                    } else {
                        // Optionally, throw an error or log a warning if the site domain is invalid
                        // For now, we'll just not update it if it's invalid and not empty.
                        // If it's empty, it's fine.
                        console.warn(
                            `Invalid siteDomain provided: ${newSiteDomain}. Not updated.`,
                        );
                        // Or: throw new ActionError({ code: 'BAD_REQUEST', message: `Invalid site domain format: ${newSiteDomain}` });
                        // Depending on desired strictness. Keeping it lenient for now.
                    }
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'convertToWebP',
                    )
                ) {
                    updatedSettings.convertToWebP =
                        newSettingsToUpdate.convertToWebP;
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'uploadMaxFileSizeMb',
                    )
                ) {
                    const val = Number(newSettingsToUpdate.uploadMaxFileSizeMb);
                    updatedSettings.uploadMaxFileSizeMb =
                        isNaN(val) || val < 1
                            ? defaults.uploadMaxFileSizeMb
                            : val;
                }
                if (
                    Object.prototype.hasOwnProperty.call(
                        newSettingsToUpdate,
                        'uploadMaxFilesPerUpload',
                    )
                ) {
                    const val = Number(
                        newSettingsToUpdate.uploadMaxFilesPerUpload,
                    );
                    updatedSettings.uploadMaxFilesPerUpload =
                        isNaN(val) || val < 1
                            ? defaults.uploadMaxFilesPerUpload
                            : val;
                }

                // 3. Save updated settings object
                await IMGBED_KV.put(
                    APP_SETTINGS_KEY,
                    JSON.stringify(updatedSettings),
                );

                // 4. (Optional) Delete old individual keys after successful update to the new consolidated key.
                // This is a good practice to clean up, but ensure the new system is stable first.
                // For now, we will not delete them automatically to allow for rollback if needed.
                // const oldKeysToDelete = Object.values(CONFIG_KEYS);
                // for (const oldKey of oldKeysToDelete) {
                //    try { await IMGBED_KV.delete(oldKey); } catch (delErr) { console.warn(`Failed to delete old config key ${oldKey}:`, delErr); }
                // }

                return { message: 'Settings updated successfully' };
            } catch (e: any) {
                throw new ActionError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Failed to update settings: ${e.message || e}`,
                });
            }
        },
    }),
};
