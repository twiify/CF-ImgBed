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
  const { locals, request, cookies, redirect, url } = context; // url is already a URL object
  const { IMGBED_KV } = locals.runtime.env;
  
  // Determine 'secure' based on the protocol of the current request URL
  const secure = url.protocol === 'https:';
  const cookieName = secure ? '__Secure-sid' : 'sid';
  
  const sessionId = cookies.get(cookieName)?.value;
  let user = null;

  if (sessionId && IMGBED_KV) {
    user = await getSessionUser(sessionId, IMGBED_KV);
  }

  // Store user in locals for access in pages/endpoints
  locals.user = user;

  // Redirect to login if trying to access protected routes without a valid session
  const isProtectedRoute = PROTECTED_ROUTES.some(route => url.pathname.startsWith(route));
  
  if (isProtectedRoute && !user) {
    // Allow access to login page itself even if it's technically under a protected path prefix (if any)
    if (url.pathname === '/login') {
      return next();
    }
    return redirect('/login', 302);
  }
  
  // If user is logged in and tries to access /login, redirect to admin
  if (user && url.pathname === '/login') {
    return redirect('/admin', 302);
  }

  return next();
});
