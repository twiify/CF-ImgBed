import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid'; // For generating session IDs
import { createSessionCookie } from '~/lib/utils'; // Import the utility function

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
  const validPassword = password === AUTH_PASSWORD; // IMPORTANT: Plain text password comparison. Consider hashing in a real-world scenario.

  if (!validUsername || !validPassword) {
    return redirect('/login?error=invalid_credentials', 302);
  }

  const sessionId = nanoid(32); // Generate a cryptographically strong session ID
  // For a single-admin setup, userId can be static. For multi-user, fetch/assign dynamically.
  const sessionData = { userId: "admin_user_01", username }; 

  try {
    const sessionDurationSeconds = 7 * 24 * 60 * 60; // 7 days
    // Store session in KV with expiration
    await IMGBED_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: sessionDurationSeconds });
    
    // Create and set the session cookie using the utility function
    const cookieHeader = createSessionCookie(sessionId, new URL(request.url), sessionDurationSeconds);
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin', // Redirect to admin dashboard upon successful login
        'Set-Cookie': cookieHeader,
      }
    });

  } catch (e) {
    console.error("Error creating session or storing in KV:", e);
    return redirect('/login?error=session_creation_failed', 302);
  }
};

// Fallback for GET requests or other methods to this endpoint
export const ALL: APIRoute = ({ redirect }) => {
  return redirect('/login', 302);
};
