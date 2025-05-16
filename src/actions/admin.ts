import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { nanoid } from 'nanoid';

import { simpleHash } from '~/lib/utils';
import type { ApiKeyRecord, AppSettings } from '~/lib/consts';
import { CONFIG_KEYS, APP_SETTINGS_KEY } from '~/lib/consts';

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
                                    keyPrefix: record.keyPrefix,
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

            const keyName = input.name?.trim() || `API Key ${nanoid(5)}`;
            const permissions = input.permissions || ['upload'];
            const keyId = nanoid(16);
            const publicIdPart = nanoid(12);
            const secretKeyPart = nanoid(32);
            const keyPrefix = `imgbed_sk_${publicIdPart}`;
            const fullApiKey = `${keyPrefix}_${secretKeyPart}`;
            const hashedFullApiKey = await simpleHash(fullApiKey);
            const newApiKeyRecord: ApiKeyRecord = {
                id: keyId,
                name: keyName,
                userId: user.userId,
                keyPrefix,
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
                        keyPrefix: newApiKeyRecord.keyPrefix,
                        createdAt: newApiKeyRecord.createdAt,
                        permissions: newApiKeyRecord.permissions,
                        status: newApiKeyRecord.status,
                    },
                };
            } catch (e: any) {
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
                if (record.userId !== user.userId)
                    throw new ActionError({
                        code: 'FORBIDDEN',
                        message: 'Forbidden',
                    });

                // 从 keyPrefix 中提取 publicIdPart
                // keyPrefix 格式: imgbed_sk_publicIdPart
                const prefixParts = record.keyPrefix.split('_');
                let publicIdPartToDelete: string | null = null;
                if (
                    prefixParts.length === 3 &&
                    prefixParts[0] === 'imgbed' &&
                    prefixParts[1] === 'sk'
                ) {
                    publicIdPartToDelete = prefixParts[2];
                }

                // 删除两条记录
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
                const settingsStr = await (IMGBED_KV as any).get(
                    APP_SETTINGS_KEY,
                    { type: 'text', consistency: 'strong' },
                );

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

                // If settings are not fully populated from APP_SETTINGS_KEY, try migrating from old keys
                // This also handles the case where APP_SETTINGS_KEY doesn't exist yet
                if (!settingsStr || Object.keys(settings).length === 0) {
                    console.log(
                        'Attempting to migrate settings from individual KV keys...',
                    );
                    const oldSettings: AppSettings = {};
                    const defaultCopyFormat = await (IMGBED_KV as any).get(
                        CONFIG_KEYS.defaultCopyFormat,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (defaultCopyFormat)
                        oldSettings.defaultCopyFormat = defaultCopyFormat;

                    const customImagePrefix = await (IMGBED_KV as any).get(
                        CONFIG_KEYS.customImagePrefix,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (customImagePrefix !== null)
                        oldSettings.customImagePrefix = customImagePrefix;

                    const enableHotlinkProtectionStr = await (
                        IMGBED_KV as any
                    ).get(CONFIG_KEYS.enableHotlinkProtection, {
                        type: 'text',
                        consistency: 'strong',
                    });
                    if (enableHotlinkProtectionStr)
                        oldSettings.enableHotlinkProtection =
                            enableHotlinkProtectionStr === 'true';

                    const allowedDomainsStr = await (IMGBED_KV as any).get(
                        CONFIG_KEYS.allowedDomains,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (allowedDomainsStr) {
                        try {
                            oldSettings.allowedDomains = JSON.parse(
                                allowedDomainsStr,
                            ) as string[];
                        } catch (e) {
                            /* ignore parsing error */
                        }
                    }

                    const siteDomain = await (IMGBED_KV as any).get(
                        CONFIG_KEYS.siteDomain,
                        { type: 'text', consistency: 'strong' },
                    );
                    if (siteDomain !== null)
                        oldSettings.siteDomain = siteDomain;

                    // If old settings were found, use them and try to save them to the new key
                    if (Object.keys(oldSettings).length > 0) {
                        settings = { ...oldSettings }; // Use a copy
                        try {
                            await IMGBED_KV.put(
                                APP_SETTINGS_KEY,
                                JSON.stringify(settings),
                            );
                            console.log(
                                'Successfully migrated settings to new key:',
                                APP_SETTINGS_KEY,
                            );
                            // Optionally, delete old keys here or in a separate migration script
                            // For now, we'll leave them to avoid data loss if something goes wrong.
                        } catch (e) {
                            console.error(
                                'Failed to save migrated settings to new key:',
                                e,
                            );
                        }
                    }
                }

                // Ensure all AppSettings fields have default values if not present
                const defaults: AppSettings = {
                    defaultCopyFormat: 'markdown',
                    customImagePrefix: '',
                    enableHotlinkProtection: false,
                    allowedDomains: [],
                    siteDomain: '',
                    convertToWebP: false, // Default for new setting
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
                convertToWebP: z.boolean().optional(), // New setting in schema
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
                const settingsStr = await (IMGBED_KV as any).get(
                    APP_SETTINGS_KEY,
                    { type: 'text', consistency: 'strong' },
                );
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
                    convertToWebP: false, // Default for new setting
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
                    updatedSettings.customImagePrefix = (
                        newSettingsToUpdate.customImagePrefix || ''
                    ).trim();
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
                    updatedSettings.siteDomain = (
                        newSettingsToUpdate.siteDomain || ''
                    ).trim();
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
