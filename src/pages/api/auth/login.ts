import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid'; // For generating session IDs

// Helper function to set cookie (can be moved to a lib file later)
function createSessionCookie(sessionId: string, requestUrl: URL) {
  // Determine 'secure' based on the protocol of the request URL
  const secure = requestUrl.protocol === 'https:';
  const cookieName = secure ? '__Secure-sid' : 'sid';
  const expires = new Date();
  expires.setDate(expires.getDate() + 7); // 7-day expiry

  return `${cookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
}


export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const formData = await request.formData();
  const username = formData.get('username');
  const password = formData.get('password');

  if (typeof username !== 'string' || username.length < 3 || typeof password !== 'string' || password.length < 6) {
    return redirect('/login?error=invalid_credentials', 302);
  }

  const { AUTH_USERNAME, AUTH_PASSWORD, IMGBED_KV } = locals.runtime.env;

  if (!IMGBED_KV) {
    console.error('IMGBED_KV environment variable is not set or KV namespace not bound.');
    return redirect('/login?error=server_setup_issue_kv', 302);
  }

  if (!AUTH_USERNAME || !AUTH_PASSWORD) {
    console.error('Authentication environment variables are not set.');
    return redirect('/login?error=server_setup_issue_auth', 302);
  }

  const validUsername = username === AUTH_USERNAME;
  const validPassword = password === AUTH_PASSWORD; // Plain text comparison as per earlier decision

  if (!validUsername || !validPassword) {
    return redirect('/login?error=invalid_credentials', 302);
  }

  const sessionId = nanoid(32); // Generate a secure session ID
  const sessionData = { userId: "default-user", username }; // Store minimal session data

  try {
    // Store session in KV with a 7-day expiration (in seconds)
    await IMGBED_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: 7 * 24 * 60 * 60 });
    
    // Set the session cookie
    // Astro's cookies.set doesn't directly support all attributes like HttpOnly in the same way for Pages functions.
    // We construct the Set-Cookie header manually for full control.
    // cookies.set('sid', sessionId, {
    //   path: '/',
    //   httpOnly: true,
    //   secure: locals.request.url.protocol === 'https:', // Secure only on HTTPS
    //   sameSite: 'lax',
    //   maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    // });
    // Using manual header for better control in CF Pages environment
    const cookieHeader = createSessionCookie(sessionId, new URL(request.url));
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': cookieHeader,
      }
    });

  } catch (e) {
    console.error("Error creating session in KV:", e);
    return redirect('/login?error=session_creation_failed', 302);
  }
};

// Fallback for GET requests or other methods to this endpoint
export const ALL: APIRoute = ({ redirect }) => {
  return redirect('/login', 302);
};
