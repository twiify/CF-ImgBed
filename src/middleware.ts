import { defineMiddleware } from 'astro:middleware';

const PROTECTED_ROUTES = ['/admin']; // Add more routes or use wildcards like '/admin/*'

async function getSessionUser(sessionId: string, kv: KVNamespace) {
  if (!sessionId) return null;
  try {
    const sessionDataString = await kv.get(`session:${sessionId}`);
    if (!sessionDataString) return null;
    return JSON.parse(sessionDataString) as { userId: string; username: string }; // Adjust type as needed
  } catch (e) {
    console.error('Error retrieving session from KV:', e);
    return null;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, request, cookies, redirect, url } = context;
  const { IMGBED_KV } = locals.runtime.env; // KV namespace from Cloudflare bindings

  // Dynamically set cookie name and 'secure' attribute based on request protocol
  // For HTTPS, use '__Secure-' prefix for enhanced security (prevents cookie from being sent over HTTP)
  const isSecureContext = url.protocol === 'https:';
  const cookieName = isSecureContext ? '__Secure-sid' : 'sid'; // Session ID cookie name
  
  const sessionId = cookies.get(cookieName)?.value;
  let user = null;

  if (sessionId && IMGBED_KV) {
    user = await getSessionUser(sessionId, IMGBED_KV);
  }

  // Make user information available to all pages and API endpoints via `Astro.locals`
  locals.user = user;

  // --- Route Protection Logic ---
  const currentPath = url.pathname;
  const isProtectedRoute = PROTECTED_ROUTES.some(route => currentPath.startsWith(route));
  
  if (isProtectedRoute && !user) {
    // If trying to access a protected route without being logged in,
    // redirect to the login page.
    // Exception: Allow access to the login page itself, even if it might fall under a protected prefix (e.g. /admin/login).
    if (currentPath === '/login') {
      return next(); // Allow access to /login
    }
    return redirect('/login', 302); // Redirect to login for other protected routes
  }
  
  // If a logged-in user tries to access the /login page, redirect them to the admin dashboard.
  if (user && currentPath === '/login') {
    return redirect('/admin', 302);
  }

  // Continue to the requested page/endpoint if no redirection is needed
  return next();
});
