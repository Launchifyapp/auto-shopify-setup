/**
 * Session Token utilities for Shopify App Bridge authentication
 * Using session tokens for user authentication as required by Shopify app review
 */

declare global {
  interface Window {
    shopify?: {
      idToken: () => Promise<string>;
      config: {
        shop: string;
        host: string;
        apiKey: string;
      };
    };
  }
}

/**
 * Get a session token from Shopify App Bridge
 * This function should be called from client-side code only
 * @returns Promise<string> The session token
 */
export async function getSessionToken(): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('getSessionToken can only be called from client-side code');
  }

  // Wait for App Bridge to be ready
  await waitForAppBridge();

  if (!window.shopify?.idToken) {
    throw new Error('Shopify App Bridge is not properly initialized');
  }

  return window.shopify.idToken();
}

/**
 * Wait for Shopify App Bridge to be ready
 */
function waitForAppBridge(timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.shopify) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.shopify) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for Shopify App Bridge'));
      }
    }, 100);
  });
}

/**
 * Make an authenticated API call using session tokens
 * @param url The API URL
 * @param options Fetch options
 * @returns Promise<Response>
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  });
}
