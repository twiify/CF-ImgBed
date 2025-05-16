interface Env {
    AUTH_USERNAME?: string;
    AUTH_PASSWORD?: string;

    // Unified KV Namespace for the application
    IMGBED_KV: KVNamespace;

    // Add other environment variables here, e.g., R2 buckets
    IMGBED_R2: R2Bucket;
    // CF_PAGES_URL and CF_PAGES_BRANCH are removed as per user request
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
    interface Locals extends Runtime {
        user?: {
            userId: string;
            username: string;
            // Add other user-specific properties if needed
        } | null;
    }
}
