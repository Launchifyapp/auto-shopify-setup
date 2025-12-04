# Shopify App Compliance Summary

This document summarizes how this application meets Shopify's app requirements.

## ✅ Compliance Status

This app is **fully compliant** with Shopify's latest requirements:

### 1. App Bridge from Shopify CDN ✅

**Requirement:** Apps must load the latest App Bridge script from Shopify's CDN.

**Implementation:**
- Location: `app/layout.tsx`
- Script: `<script src="https://cdn.shopify.com/shopifycloud/app-bridge/v3"></script>`
- Benefit: Automatic security updates and fixes from Shopify

**Why it matters:**
- Ensures the app always uses the latest version
- Shopify can push security patches immediately
- Reduces attack surface

### 2. Session Token Authentication ✅

**Requirement:** Apps must use session tokens (JWTs) for user authentication in embedded contexts.

**Implementation:**

**Client-Side** (`lib/utils/sessionToken.ts`):
```typescript
// Get session token from App Bridge
const token = await getSessionToken();

// Include in API requests
fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Server-Side** (`lib/utils/verifySessionToken.ts`):
```typescript
// Verify token and extract shop
const auth = authenticateRequest(req);
if (!auth) {
  return new Response('Unauthorized', { status: 401 });
}
```

**Verification Process:**
1. Validates JWT signature using `SHOPIFY_API_SECRET`
2. Checks token expiration (`exp` claim)
3. Verifies not-before time (`nbf` claim)
4. Validates audience matches API key (`aud` claim)
5. Confirms issuer is Shopify domain (`iss` claim)

**Why it matters:**
- Tokens are short-lived (secure by default)
- Scoped to specific shops
- Cannot be forged without API secret
- Safe for use in embedded iframes

### 3. Secure Configuration Management ✅

**Requirement:** Sensitive configuration must not be publicly accessible.

**Implementation:**

**shopify.app.toml:**
- Added to `.gitignore` (line 13-15)
- Never deployed to hosting provider
- Only deployed via `shopify app deploy` command
- Template provided: `shopify.app.toml.example`

**Environment Variables:**
- All secrets stored as environment variables
- `.env.example` documents required variables
- No hard-coded credentials in source code
- Different values for dev/prod environments

**Why it matters:**
- Prevents exposure of API secrets
- Allows secure deployment across environments
- Separates configuration from code
- Follows security best practices

## 📋 Required Environment Variables

All of these are documented in `.env.example`:

| Variable | Purpose | Sensitivity |
|----------|---------|-------------|
| `SHOPIFY_API_KEY` | App identification | Public |
| `SHOPIFY_API_SECRET` | JWT signing/verification | **PRIVATE** |
| `SHOPIFY_APP_URL` | App URL configuration | Public |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access | **PRIVATE** |
| `SHOPIFY_STOREFRONT_TOKEN` | Storefront API access | **PRIVATE** |
| `NEXT_PUBLIC_SHOPIFY_API_KEY` | Client-side App Bridge | Public |

## 🚀 Two-Deployment Process

This app follows Shopify's recommended deployment approach:

### Deployment 1: Application Code
**Target:** Hosting provider (Vercel, Firebase, etc.)
**Command:** `npm run build && vercel deploy --prod` (or provider-specific)
**Contains:**
- Frontend assets
- Backend API routes
- Server-side code
- **NOT** shopify.app.toml

### Deployment 2: App Configuration
**Target:** Shopify Partner Dashboard
**Command:** `shopify app deploy`
**Contains:**
- App URLs and redirect URIs
- OAuth scopes
- Webhook subscriptions
- App metadata

**Why separate deployments?**
- Configuration stays with Shopify (not on public hosting)
- Easier to update URLs and scopes
- More secure (no exposed TOML files)
- Follows Shopify best practices

## 📚 Documentation

Comprehensive documentation has been created:

- **README.md** - Quick start, architecture, and overview
- **DEPLOYMENT.md** - Step-by-step deployment guide with examples
- **SECURITY.md** - Security best practices and compliance details
- **.env.example** - Environment variable template
- **shopify.app.toml.example** - Configuration file template

## 🔐 Security Features

1. **JWT Verification:** All session tokens verified server-side
2. **Environment Variables:** Secrets never in code
3. **HTTPS Only:** All URLs use secure protocol
4. **Webhook Verification:** HMAC signature validation
5. **Scope Minimization:** Only requests necessary permissions
6. **Error Handling:** No sensitive data in error messages
7. **Gitignore:** Sensitive files excluded from version control

## ✓ Pre-Deployment Checklist

Before deploying to production, ensure:

- [ ] All environment variables configured in hosting provider
- [ ] `shopify.app.toml` updated with production URLs
- [ ] `shopify app deploy` run to update Partner Dashboard
- [ ] App tested on development store
- [ ] HTTPS enabled on hosting
- [ ] Error logging configured (without sensitive data)
- [ ] Monitoring set up for API failures
- [ ] Documentation updated for team

## 🔄 Maintenance

### Regular Updates
- Keep dependencies up to date: `npm audit && npm update`
- Monitor Shopify API version changes
- Test after App Bridge updates
- Review security advisories

### When to Run `shopify app deploy`
- URLs change (redirect URIs, application URL)
- Scopes added/removed
- Webhook subscriptions modified
- App metadata updated

**Note:** Don't run on every code change, only when TOML changes.

## 📞 Support

For questions about:
- **Deployment:** See DEPLOYMENT.md
- **Security:** See SECURITY.md
- **Shopify APIs:** [Shopify Developer Docs](https://shopify.dev)
- **App Bridge:** [App Bridge Documentation](https://shopify.dev/docs/api/app-bridge-library)

## Summary

This app is fully compliant with Shopify's requirements:
- ✅ App Bridge v3 from CDN
- ✅ Session token authentication
- ✅ Secure configuration management
- ✅ Two-deployment process
- ✅ Comprehensive documentation

All implementation details are documented and ready for production deployment.
