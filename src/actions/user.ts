import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { nanoid } from 'nanoid';

export const user = {
    login: defineAction({
        accept: 'form',
        input: z.object({
          username: z.string().min(3, { message: "Username must be at least 3 characters long" }),
          password: z.string().min(6, { message: "Password must be at least 6 characters long" }),
        }),
        handler: async ({ username, password }, context) => {
          const { locals, cookies, request } = context;
          const { AUTH_USERNAME, AUTH_PASSWORD, IMGBED_KV } = locals.runtime.env;
    
          if (!IMGBED_KV) {
            throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server setup issue: KV namespace not available.' });
          }
          if (!AUTH_USERNAME || !AUTH_PASSWORD) {
            throw new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server setup issue: Authentication credentials not configured.' });
          }
          if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
            throw new ActionError({ code: 'UNAUTHORIZED', message: 'Invalid username or password.' });
          }
    
          const sessionId = nanoid(32);
          const sessionData = { userId: "admin_user_01", username };
          const sessionDurationSeconds = 7 * 24 * 60 * 60; // 7 days
    
          try {
            await IMGBED_KV.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: sessionDurationSeconds });
            const isSecureContext = new URL(request.url).protocol === 'https:';
            const cookieName = isSecureContext ? '__Secure-sid' : 'sid';
            cookies.set(cookieName, sessionId, {
              path: '/', httpOnly: true, secure: isSecureContext, sameSite: 'lax', maxAge: sessionDurationSeconds,
            }); // Correctly close the cookies.set() call with a semicolon.
    
            // Action indicates success and where to redirect.
            // The page calling the action will handle the redirect.
            return { success: true, redirectTo: '/admin' };
          } catch (e: any) { // Restore the catch block content
            console.error("Error creating session or storing in KV:", e);
            throw new ActionError({
              code: 'INTERNAL_SERVER_ERROR',
              message: e.message || 'Failed to create session.',
            });
          }
        }
      }),
    
      logout: defineAction({
        accept: 'json',
        handler: async (_, { locals, cookies, request }) => {
          const { IMGBED_KV } = locals.runtime.env;
          const isSecureContext = new URL(request.url).protocol === 'https:';
          const cookieName = isSecureContext ? '__Secure-sid' : 'sid';
          const sessionId = cookies.get(cookieName)?.value;
    
          if (sessionId && IMGBED_KV) {
            try {
              await IMGBED_KV.delete(`session:${sessionId}`);
            } catch (e) {
              console.error(`Action: Error deleting session ${sessionId} from KV:`, e);
            }
          }
          
          // More aggressive cookie clearing
          cookies.set(cookieName, '', { // Set to empty value
            path: '/',
            httpOnly: true,
            secure: isSecureContext,
            sameSite: 'lax',
            expires: new Date(0) // Set to a past date (epoch)
          });
          // cookies.delete() should also work, but this is more explicit for some browsers/setups.
          // cookies.delete(cookieName, { path: '/', httpOnly: true, secure: isSecureContext, sameSite: 'lax' });
          
          return { success: true, redirectTo: '/login' };
        }
      }),
};