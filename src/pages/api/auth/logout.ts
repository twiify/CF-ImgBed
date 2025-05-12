import type { APIRoute } from 'astro';
import { createSessionCookie } from '~/lib/utils'; // Assuming createSessionCookie can also create an expired cookie

export const GET: APIRoute = async ({ locals, cookies, redirect, request }) => {
  const { IMGBED_KV } = locals.runtime.env;

  // Determine 'secure' based on the protocol of the current request URL
  // This logic should be consistent with how session cookies are set during login
  const requestUrl = new URL(request.url);
  const isSecureContext = requestUrl.protocol === 'https:';
  const cookieName = isSecureContext ? '__Secure-sid' : 'sid';

  const sessionId = cookies.get(cookieName)?.value;

  if (sessionId && IMGBED_KV) {
    try {
      await IMGBED_KV.delete(`session:${sessionId}`);
      console.log(`Session ${sessionId} deleted from KV.`);
    } catch (e) {
      console.error(`Error deleting session ${sessionId} from KV:`, e);
      // Continue to clear cookie even if KV deletion fails, to ensure user is logged out client-side
    }
  }

  // Clear the session cookie by setting its Max-Age to 0 or Expires to a past date
  // We can re-use createSessionCookie by passing a maxAge of 0 or a negative value if it supports it,
  // or construct the header manually.
  // For simplicity, let's construct manually for an expired cookie.
  
  const expiredCookieHeader = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isSecureContext ? '; Secure' : ''}`;

  // Redirect to login page with a Set-Cookie header to clear the cookie
  return new Response(null, {
    status: 302, // Found, redirect
    headers: {
      'Location': '/login',
      'Set-Cookie': expiredCookieHeader,
    }
  });
};

// Optional: Handle POST requests as well if forms are used for logout
export const POST: APIRoute = async (context) => {
    return GET(context);
};
