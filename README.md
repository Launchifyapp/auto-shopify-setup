# Auto Shopify Setup

A Next.js application for automated Shopify store setup, compliant with Shopify's latest app requirements including App Bridge v3 and session token authentication.

## 🔒 Security & Compliance

This app is built to comply with Shopify's app requirements:

- ✅ **App Bridge v3** - Loads the latest App Bridge script from Shopify's CDN
- ✅ **Session Token Authentication** - Uses short-lived JWT tokens for secure API calls
- ✅ **Secure Configuration** - Sensitive data stored in environment variables, not in code

## 📋 Prerequisites

- Node.js 18+ and npm
- A Shopify Partner account
- Shopify CLI installed (`npm install -g @shopify/cli @shopify/app`)
- A hosting provider (Firebase, Vercel, etc.)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd auto-shopify-setup
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

Required environment variables:

- `SHOPIFY_API_KEY` - Your app's API key (from Partner Dashboard)
- `SHOPIFY_API_SECRET` - Your app's API secret (keep this private!)
- `SHOPIFY_APP_URL` - Your deployed app URL
- `SHOPIFY_ADMIN_TOKEN` - Admin API access token
- `SHOPIFY_STOREFRONT_TOKEN` - Storefront API access token
- `NEXT_PUBLIC_SHOPIFY_API_KEY` - Public API key for client-side App Bridge

### 3. Development

```bash
npm run dev
```

Visit `http://localhost:3000` to see your app running locally.

## 📦 Deployment

**Important:** This app requires TWO separate deployments:

### Deployment 1: App Code to Your Hosting Provider

Deploy your application code (frontend, backend, API routes) to your hosting provider:

**For Firebase:**
```bash
npm run build
firebase deploy
```

**For Vercel:**
```bash
vercel deploy --prod
```

**Environment Variables in Production:**

Make sure to configure these in your hosting provider's environment settings:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SHOPIFY_ADMIN_TOKEN`
- `SHOPIFY_STOREFRONT_TOKEN`
- `NEXT_PUBLIC_SHOPIFY_API_KEY`

### Deployment 2: App Configuration to Shopify

Deploy your app configuration to Shopify using the Shopify CLI:

```bash
shopify app deploy
# or for older CLI versions:
shopify deploy
```

This command:
- Reads your `shopify.app.toml` configuration
- Updates your app registration in the Shopify Partner Dashboard
- Configures redirect URLs, scopes, and webhooks
- Does NOT upload the TOML file to your hosting

**⚠️ Important Security Note:**

- **Never** deploy `shopify.app.toml` to your public hosting
- **Never** commit sensitive data to your repository
- **Always** use environment variables for secrets
- The `shopify.app.toml` file is already in `.gitignore`

## 🔐 Authentication Flow

### Session Token Authentication

This app uses Shopify's modern session token authentication:

1. **Client-Side:** App Bridge provides short-lived JWT tokens
2. **API Requests:** Client includes token in `Authorization: Bearer <token>` header
3. **Server-Side:** API routes verify the token signature and claims
4. **Security:** Tokens are scoped, short-lived, and validated on every request

### Implementation Details

**Client-Side (`lib/utils/sessionToken.ts`):**
```typescript
import { getSessionToken } from '@/lib/utils/sessionToken';

// Get session token from App Bridge
const token = await getSessionToken();

// Make authenticated API call
fetch('/api/setup-shop', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**Server-Side (`lib/utils/verifySessionToken.ts`):**
```typescript
import { authenticateRequest } from '@/lib/utils/verifySessionToken';

export async function GET(req: NextRequest) {
  // Verify session token and extract shop
  const auth = authenticateRequest(req);
  if (!auth) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  const { shop } = auth;
  // ... proceed with authenticated request
}
```

## 🏗️ Architecture

### App Bridge v3 Integration

The app loads App Bridge from Shopify's CDN in `app/layout.tsx`:

```html
<script src="https://cdn.shopify.com/shopifycloud/app-bridge/v3"></script>
```

This ensures:
- Always uses the latest security patches
- Automatic updates from Shopify
- Compliance with Shopify's app requirements

### Project Structure

```
├── app/
│   ├── api/              # API routes
│   │   ├── auth/         # OAuth callback
│   │   ├── setup-shop/   # Shop setup endpoint
│   │   ├── webhooks/     # Webhook handlers
│   ├── layout.tsx        # Root layout with App Bridge
│   └── page.tsx          # Install landing page
├── lib/
│   ├── utils/
│   │   ├── sessionToken.ts       # Client-side token utilities
│   │   └── verifySessionToken.ts # Server-side token verification
│   ├── shopify.ts        # Shopify API client
│   └── setupShop.ts      # Shop setup logic
├── shopify.app.toml      # Shopify config (DO NOT DEPLOY TO HOSTING)
├── .env.example          # Environment variable template
└── .gitignore            # Excludes sensitive files
```

## 🔧 Configuration Files

### shopify.app.toml

This file contains your app's configuration:
- Client ID
- App URLs
- OAuth scopes
- Webhook subscriptions
- Redirect URLs

**Security Note:** This file contains sensitive configuration and should:
- ✅ Be deployed via `shopify app deploy` command
- ✅ Be listed in `.gitignore`
- ❌ NOT be uploaded to your hosting provider
- ❌ NOT be committed to public repositories

### Environment Variables

All sensitive values (API keys, secrets, tokens) must be stored as environment variables:

- **Development:** Use `.env.local` (gitignored)
- **Production:** Configure in your hosting provider's dashboard
- **CI/CD:** Store in your CI system's secrets manager

## 📚 Additional Resources

- [Shopify App Bridge Documentation](https://shopify.dev/docs/api/app-bridge-library)
- [Session Token Authentication](https://shopify.dev/docs/apps/auth/oauth/session-tokens)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify API Documentation](https://shopify.dev/docs/api)

## 🐛 Troubleshooting

### Build fails with missing environment variables

Make sure all required environment variables are set in your `.env.local` file or hosting provider's environment settings.

### "Invalid session token" errors

1. Verify `SHOPIFY_API_SECRET` is correctly set
2. Check that `SHOPIFY_API_KEY` matches your Partner Dashboard
3. Ensure App Bridge is loaded from Shopify's CDN
4. Verify your app URL matches the deployed URL

### OAuth callback errors

1. Check redirect URLs in `shopify.app.toml` match your deployed URL
2. Run `shopify app deploy` to update configuration in Partner Dashboard
3. Verify `SHOPIFY_APP_URL` environment variable is correct

## 📄 License

[Your License Here]

## 🤝 Contributing

[Your Contributing Guidelines Here]
