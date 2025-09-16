import { defineMiddleware } from 'astro:middleware';
import { getActionContext } from 'astro:actions'; // Import getActionContext from astro:actions

const PROTECTED_ROUTES = ['/admin']; // Add more routes or use wildcards like '/admin/*'

async function getSessionUser(sessionId: string, kv: KVNamespace) {
    if (!sessionId) return null;
    try {
        const sessionDataString = await kv.get(`session:${sessionId}`);
        if (!sessionDataString) return null;
        return JSON.parse(sessionDataString) as {
            userId: string;
            username: string;
        }; // Adjust type as needed
    } catch (e) {
        console.error('Error retrieving session from KV:', e);
        return null;
    }
}

export const onRequest = defineMiddleware(async (context, next) => {
    const { locals, request, cookies, redirect, url } = context;
    const { IMGBED_KV } = locals.runtime.env;

    // --- Action Result Handling for PRG pattern ---
    const {
        action: actionInfo,
        setActionResult: _setActionResult,
        serializeActionResult: _serializeActionResult,
    } = getActionContext(context);

    if (
        request.method === 'POST' &&
        actionInfo?.name &&
        actionInfo.calledFrom === 'form'
    ) {
        // This block will run *after* the action handler has executed for a form POST.
        // The action handler itself (e.g., login, logout) would have run, set cookies, etc.
        // Now we decide where to redirect based on the action that was called.
        // We need to call the action handler again to get its result,
        // or rely on a conventional signal if the action itself doesn't need to return complex data for redirection.
        // For login/logout, the primary goal is the side effect (cookie set/cleared) and then redirect.
        // Let's assume the action handler (e.g., actions.login, actions.logout)
        // returns an object like { success: true, redirectTo?: string } or throws ActionError.
        // We need to re-evaluate how to get this result *after* it has run.
        // The `getActionContext` is more for *before* the action runs or for advanced session-based result passing.
        // A simpler approach for immediate redirect after form-based action:
        // The action handler itself should ideally not perform the redirect.
        // The page that *renders* the form should use Astro.getActionResult() and then Astro.redirect().
        // Given the current problem (logout form is in a layout, login form is on a page):
        // For login on /login.astro:
        //   - login.astro already has logic: if (result.data?.success && result.data.redirectTo) { return Astro.redirect(result.data.redirectTo); }
        //   - This should work if actions.login returns { success: true, redirectTo: '/admin' }.
        // For logout from AdminLayout.astro:
        //   - This is trickier because AdminLayout cannot do Astro.redirect().
        //   - One way is to have the logout form POST, action clears cookie, then Astro re-renders the current admin page.
        //   - On this re-render (which is a GET), the middleware *should* catch the no-session state and redirect to /login.
        // Let's re-verify the middleware's core logic for redirection based on session.
        // The issue might be that the "current page" re-render after logout POST doesn't trigger a new enough context for middleware.
    }

    // --- Session and User Authentication ---

    const isSecureContext = url.protocol === 'https:';
    const cookieName = isSecureContext ? '__Secure-sid' : 'sid';

    const sessionIdFromCookie = cookies.get(cookieName)?.value;

    let user = null;
    if (sessionIdFromCookie && IMGBED_KV) {
        user = await getSessionUser(sessionIdFromCookie, IMGBED_KV);
    } else if (sessionIdFromCookie && !IMGBED_KV) {
        console.error(
            '[Middleware] IMGBED_KV not available, cannot validate session.',
        );
    }

    locals.user = user;

    // --- Route Protection & Redirection Logic ---
    const currentPath = url.pathname;
    const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
        currentPath.startsWith(route),
    );

    // If the request is for an action endpoint, let it pass through the main protection logic for now.
    // Actions will handle their own auth. The main concern here is page access.
    if (currentPath.startsWith('/_actions')) {
        return next();
    }

    if (isProtectedRoute && !user) {
        if (currentPath === '/login') {
            // Should not happen if /login is not in PROTECTED_ROUTES
            return next();
        }
        // If trying to access a protected route without being logged in, redirect to login.
        return redirect('/login', 302);
    }

    // If a logged-in user tries to access the /login page, redirect them to the admin dashboard.
    if (user && currentPath === '/login') {
        return redirect('/admin', 302);
    }

    // If logout action was just called (form submission from a protected page)
    // and the cookie is now cleared, this middleware run (for the GET request to the same protected page)
    // should now redirect to /login because !user will be true.
    // The key is that the POST to the action endpoint must result in a GET to the original page,
    // which then re-runs middleware.

    return next();
});
