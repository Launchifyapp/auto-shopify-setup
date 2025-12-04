# Security Policy

## Security Best Practices

This document outlines the security measures and best practices implemented in this Shopify app.

## Shopify Compliance

This app is built to comply with Shopify's security requirements:

### ✅ App Bridge v3 from Shopify CDN

The app loads App Bridge from Shopify's Content Delivery Network:

```html
<script src="https://cdn.shopify.com/shopifycloud/app-bridge/v3"></script>
```

**Benefits:**
- Always uses the latest security patches
- Automatic updates from Shopify
- Reduced attack surface

**Never:** Host App Bridge locally or use outdated versions.

### ✅ Session Token Authentication

The app uses short-lived JWT session tokens instead of cookie-based authentication:

**Client-Side:** (`lib/utils/sessionToken.ts`)
- Obtains session tokens from App Bridge
- Includes tokens in API request headers

**Server-Side:** (`lib/utils/verifySessionToken.ts`)
- Verifies JWT signature using `SHOPIFY_API_SECRET`
- Validates token expiration, audience, and issuer
- Extracts shop information from verified tokens

**Benefits:**
- Tokens are short-lived (preventing long-term exposure)
- Scoped to specific shops
- Cannot be forged without API secret
- Safe for embedded iframes

## Configuration Security

### ⚠️ shopify.app.toml

The `shopify.app.toml` file contains sensitive configuration:

```toml
client_id = "..."           # App API key
application_url = "..."     # App URLs
redirect_urls = [...]       # OAuth callback URLs
```

**Security Measures:**

✅ **DO:**
- Keep `shopify.app.toml` in `.gitignore`
- Deploy configuration via Shopify CLI (`shopify app deploy`)
- Store in private repositories only
- Use environment variables for dynamic values

❌ **DON'T:**
- Commit to public repositories
- Upload to hosting provider (Firebase, Vercel, etc.)
- Share in public documentation
- Include in client-side bundles

### 🔑 Environment Variables

All secrets are stored as environment variables:

**Required Variables:**

| Variable | Sensitivity | Purpose |
|----------|-------------|---------|
| `SHOPIFY_API_KEY` | Public | App identification |
| `SHOPIFY_API_SECRET` | **PRIVATE** | JWT verification, API auth |
| `SHOPIFY_ADMIN_TOKEN` | **PRIVATE** | Admin API access |
| `SHOPIFY_STOREFRONT_TOKEN` | **PRIVATE** | Storefront API access |
| `SHOPIFY_APP_URL` | Public | App URL configuration |
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | Public | Client-side App Bridge |

**Storage:**

- **Development:** `.env.local` (gitignored)
- **Production:** Hosting provider's environment settings
- **CI/CD:** GitHub Secrets or equivalent

**Never:**
- Hard-code secrets in source code
- Commit `.env` files to version control
- Expose private variables to client-side code
- Share secrets in public channels

## Authentication Flow

### OAuth Installation Flow

1. Merchant visits installation page
2. App redirects to Shopify OAuth with:
   - `client_id` (API key)
   - Required `scopes`
   - `redirect_uri` (callback URL)
3. Merchant approves permissions
4. Shopify redirects to callback with authorization code
5. App exchanges code for access token
6. Access token stored securely (never in cookies/localStorage)

### Session Token Verification

All API requests from embedded app must include session token:

```
Authorization: Bearer <session_token>
```

Server verifies:
- ✅ Valid JWT signature (using `SHOPIFY_API_SECRET`)
- ✅ Token not expired (`exp` claim)
- ✅ Token not used before valid time (`nbf` claim)
- ✅ Audience matches API key (`aud` claim)
- ✅ Issuer is Shopify domain (`iss` claim)

## Webhook Security

Webhook handlers verify request authenticity:

```typescript
import { verifyWebhook } from '@/lib/utils/verifyWebhook';

export async function POST(req: NextRequest) {
  // Verify webhook signature
  const isValid = await verifyWebhook(req);
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Process webhook
}
```

**Verification Process:**
1. Extract `X-Shopify-Hmac-SHA256` header
2. Compute HMAC-SHA256 of request body using `SHOPIFY_API_SECRET`
3. Compare signatures using timing-safe comparison
4. Reject if signatures don't match

## Data Protection

### Access Tokens

**Storage:**
- Tokens stored in memory or secure server-side storage
- Never in cookies, localStorage, or sessionStorage
- Never sent to client-side code

**Rotation:**
- Implement token rotation on security events
- Support token refresh mechanisms
- Invalidate tokens on app uninstall

### Merchant Data

**Privacy Compliance:**
- Handle GDPR data requests via webhook handlers:
  - `customers/data_request`
  - `customers/redact`
  - `shop/redact`
- Delete merchant data on app uninstall
- Encrypt sensitive data at rest
- Use HTTPS for all communications

### Scopes

Request only necessary scopes:

```
read_files,write_files,read_products,write_products,...
```

**Best Practices:**
- Request minimum scopes needed
- Document why each scope is required
- Update scopes carefully (triggers re-authentication)
- Use optional scopes for non-critical features

## API Security

### Rate Limiting

Implement rate limiting to prevent abuse:

```typescript
// Example rate limiter
const rateLimiter = new RateLimiter({
  max: 100,        // 100 requests
  windowMs: 60000  // per minute
});
```

### Input Validation

Validate all inputs:

```typescript
// Validate shop domain
if (!shop.endsWith('.myshopify.com')) {
  return new Response('Invalid shop', { status: 400 });
}

// Sanitize user inputs
const sanitized = escapeHtml(userInput);
```

### Error Handling

Never expose sensitive information in errors:

```typescript
// ❌ BAD
return new Response(`Error: ${error.stack}`, { status: 500 });

// ✅ GOOD
console.error('Internal error:', error);
return new Response('Internal server error', { status: 500 });
```

## Network Security

### HTTPS Only

- All app URLs must use HTTPS
- Configure HSTS headers
- Use secure cookies (if any)

### Content Security Policy

Configure CSP headers to prevent XSS:

```typescript
headers: {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://cdn.shopify.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
  ].join('; ')
}
```

### CORS Configuration

Restrict CORS to Shopify domains:

```typescript
const allowedOrigins = [
  'https://admin.shopify.com',
  /https:\/\/[^\/]+\.myshopify\.com/
];
```

## Dependency Security

### Regular Updates

- Monitor security advisories
- Update dependencies regularly
- Use `npm audit` to check for vulnerabilities

```bash
npm audit
npm audit fix
```

### Lock Files

- Commit `package-lock.json` to ensure reproducible builds
- Review dependency changes in PRs
- Use tools like Dependabot for automated updates

## Monitoring and Logging

### Security Logging

Log security-relevant events:

- Authentication attempts
- Failed token verifications
- Webhook signature failures
- Rate limit violations
- API errors

### Privacy in Logs

Never log sensitive data:

- ❌ Access tokens
- ❌ API secrets
- ❌ Customer personal information
- ❌ Payment details

Log only:
- ✅ Shop domains
- ✅ Request IDs
- ✅ Error types
- ✅ Timestamps

## Incident Response

### If API Secret is Compromised

1. **Immediately:** Rotate `SHOPIFY_API_SECRET` in Partner Dashboard
2. Update environment variables in all environments
3. Redeploy application
4. Invalidate all existing sessions
5. Monitor for suspicious activity
6. Review access logs

### If Access Token is Compromised

1. Revoke the token in Shopify Admin
2. Remove from secure storage
3. Request new token via OAuth flow
4. Audit recent API calls
5. Notify affected merchant if necessary

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: [your-security-email]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work on a fix promptly.

## Security Checklist

Before deploying to production:

- [ ] All environment variables configured
- [ ] `shopify.app.toml` not deployed to hosting
- [ ] `.env` files in `.gitignore`
- [ ] HTTPS enabled
- [ ] App Bridge loaded from Shopify CDN
- [ ] Session tokens verified server-side
- [ ] Webhook signatures verified
- [ ] No secrets in client-side code
- [ ] Error messages don't expose sensitive data
- [ ] Dependencies are up to date (`npm audit`)
- [ ] Rate limiting implemented
- [ ] Input validation on all endpoints
- [ ] CORS properly configured
- [ ] Security headers set (CSP, HSTS, etc.)
- [ ] Logging configured (without sensitive data)
- [ ] Monitoring and alerting set up

## References

- [Shopify App Security](https://shopify.dev/docs/apps/best-practices/security)
- [Session Token Authentication](https://shopify.dev/docs/apps/auth/oauth/session-tokens)
- [OAuth Security Best Practices](https://shopify.dev/docs/apps/auth/oauth)
- [Webhook Verification](https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
