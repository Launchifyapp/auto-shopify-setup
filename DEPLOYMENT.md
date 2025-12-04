# Deployment Guide

This guide walks you through deploying your Shopify app using the **two-deployment approach** required for Shopify compliance.

## Overview

Shopify apps require two separate deployments:

1. **Deploy Application Code** → Your hosting provider (Firebase, Vercel, etc.)
2. **Deploy App Configuration** → Shopify Partner Dashboard (via Shopify CLI)

**Why two deployments?**

- Your app code needs to be publicly accessible for merchants to use
- Your app configuration (including sensitive metadata) should be registered with Shopify, not exposed on your hosting
- The `shopify.app.toml` file should never be publicly served from your hosting

## Prerequisites

Before you begin, ensure you have:

- ✅ A Shopify Partner account
- ✅ An app created in the Partner Dashboard
- ✅ Shopify CLI installed: `npm install -g @shopify/cli @shopify/app`
- ✅ A hosting provider account (Firebase, Vercel, etc.)
- ✅ Your app code ready to deploy

## Step 1: Prepare Environment Variables

### 1.1 Gather Required Values

From your Shopify Partner Dashboard, collect:

- **API Key** (Client ID) - Found in app settings
- **API Secret** - Found in app settings (keep this private!)
- **App URL** - Your deployed application URL (e.g., `https://your-app.com`)

### 1.2 Configure Local Development

Create a `.env.local` file:

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your values:

```env
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOPIFY_APP_URL=https://your-app-domain.com
SHOPIFY_ADMIN_TOKEN=your_admin_access_token
SHOPIFY_STOREFRONT_TOKEN=your_storefront_access_token
NEXT_PUBLIC_SHOPIFY_API_KEY=your_api_key_here
```

### 1.3 Test Locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and verify the app works.

## Step 2: Deploy to Hosting Provider

### Option A: Deploy to Vercel

#### 2.1 Install Vercel CLI

```bash
npm install -g vercel
```

#### 2.2 Configure Environment Variables

```bash
vercel env add SHOPIFY_API_KEY
vercel env add SHOPIFY_API_SECRET
vercel env add SHOPIFY_APP_URL
vercel env add SHOPIFY_ADMIN_TOKEN
vercel env add SHOPIFY_STOREFRONT_TOKEN
vercel env add NEXT_PUBLIC_SHOPIFY_API_KEY
```

#### 2.3 Deploy

```bash
npm run build  # Test build locally first
vercel deploy --prod
```

#### 2.4 Note Your Deployment URL

Vercel will output your deployment URL (e.g., `https://your-app.vercel.app`). You'll need this for the next step.

### Option B: Deploy to Firebase

#### 2.1 Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

#### 2.2 Initialize Firebase

```bash
firebase init hosting
```

Select your project and configure:
- **Public directory:** `.next` or `out` (depending on your Next.js config)
- **Single-page app:** No
- **Automatic builds and deploys with GitHub:** Optional

#### 2.3 Configure Environment Variables

For Firebase Functions (if using):

```bash
firebase functions:config:set \
  shopify.api_key="your_api_key" \
  shopify.api_secret="your_api_secret" \
  shopify.app_url="https://your-app.firebaseapp.com"
```

For Next.js on Firebase Hosting, use `.env.production`:

```bash
# Create .env.production (gitignored)
echo "SHOPIFY_API_KEY=your_key" >> .env.production
echo "SHOPIFY_API_SECRET=your_secret" >> .env.production
# ... add other variables
```

#### 2.4 Build and Deploy

```bash
npm run build
firebase deploy
```

#### 2.5 Note Your Deployment URL

Firebase will output your deployment URL (e.g., `https://your-app.firebaseapp.com`).

### Option C: Other Hosting Providers

For other platforms (Netlify, Railway, Render, etc.):

1. **Build the application:** `npm run build`
2. **Configure environment variables** in your hosting provider's dashboard
3. **Deploy** using your provider's deployment method
4. **Note your deployment URL** for the next step

## Step 3: Update shopify.app.toml

Edit your `shopify.app.toml` file and update the URLs to match your deployed app:

```toml
# shopify.app.toml

client_id = "your_client_id_from_partner_dashboard"
name = "Your App Name"
application_url = "https://your-deployed-app-url.com"  # ← Update this
embedded = true

[auth]
redirect_urls = [
  "https://your-deployed-app-url.com/api/auth/callback"  # ← Update this
]

[webhooks]
api_version = "2025-10"

# ... rest of your configuration
```

**Important:**
- The `application_url` must match your deployed hosting URL
- The `redirect_urls` must match your OAuth callback endpoint
- The `client_id` should match the API key from Partner Dashboard

## Step 4: Deploy Configuration to Shopify

Now deploy your app configuration to Shopify using the CLI:

### 4.1 Authenticate with Shopify CLI

```bash
shopify auth login
```

Follow the prompts to authenticate with your Partner account.

### 4.2 Deploy App Configuration

```bash
shopify app deploy
```

Or for older CLI versions:

```bash
shopify deploy
```

This command:
- Reads your `shopify.app.toml` file
- Updates your app registration in the Shopify Partner Dashboard
- Configures redirect URLs, scopes, and webhooks
- Does **NOT** upload the TOML file to your hosting

### 4.3 Verify Deployment

Check your Shopify Partner Dashboard:

1. Go to **Apps** → **Your App**
2. Check **App setup** → **URLs** - verify they match your deployed URLs
3. Check **App setup** → **Webhooks** - verify webhooks are configured
4. Check **Configuration** → **Scopes** - verify scopes are correct

## Step 5: Test Your Deployed App

### 5.1 Install on a Development Store

1. In Partner Dashboard, go to **Test your app**
2. Select a development store
3. Click **Install app**

### 5.2 Verify App Bridge and Session Tokens

Open browser developer tools and verify:

1. **App Bridge loads:** Check Network tab for `app-bridge/v3` from Shopify CDN
2. **Session tokens work:** Check API requests include `Authorization: Bearer <token>` headers
3. **App functions:** Test your app's functionality

### 5.3 Check for Errors

Monitor your logs:

```bash
# Vercel
vercel logs

# Firebase
firebase functions:log

# Other platforms
# Check your hosting provider's log viewer
```

## Step 6: CI/CD Setup (Optional)

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build
        run: npm run build
        env:
          SHOPIFY_API_KEY: ${{ secrets.SHOPIFY_API_KEY }}
          SHOPIFY_API_SECRET: ${{ secrets.SHOPIFY_API_SECRET }}
          SHOPIFY_APP_URL: ${{ secrets.SHOPIFY_APP_URL }}
          SHOPIFY_ADMIN_TOKEN: ${{ secrets.SHOPIFY_ADMIN_TOKEN }}
          SHOPIFY_STOREFRONT_TOKEN: ${{ secrets.SHOPIFY_STOREFRONT_TOKEN }}
          NEXT_PUBLIC_SHOPIFY_API_KEY: ${{ secrets.NEXT_PUBLIC_SHOPIFY_API_KEY }}
      
      - name: Deploy to Vercel
        run: vercel deploy --prod --token ${{ secrets.VERCEL_TOKEN }}
      
      # Note: Shopify CLI deployment typically done manually or in separate workflow
      # to avoid frequent config updates
```

**Configure GitHub Secrets:**

In your repository settings → Secrets and variables → Actions, add:
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SHOPIFY_ADMIN_TOKEN`
- `SHOPIFY_STOREFRONT_TOKEN`
- `NEXT_PUBLIC_SHOPIFY_API_KEY`
- `VERCEL_TOKEN` (or your hosting provider's token)

## Security Checklist

Before going to production:

- [ ] All environment variables are configured in hosting provider (not in code)
- [ ] `shopify.app.toml` is in `.gitignore`
- [ ] `.env.local` and `.env.production` are in `.gitignore`
- [ ] API secrets are never exposed in client-side code
- [ ] HTTPS is enabled on your deployed app
- [ ] App Bridge v3 is loaded from Shopify CDN
- [ ] Session tokens are verified on the server side
- [ ] Webhook signatures are verified
- [ ] Content Security Policy headers are configured (if applicable)

## Updating Your App

### When You Update App Code

1. Make your code changes
2. Test locally: `npm run dev`
3. Build: `npm run build`
4. Deploy to hosting: `vercel deploy --prod` (or your provider's command)

**No need to run `shopify app deploy`** unless configuration changed.

### When You Update Configuration

If you modify `shopify.app.toml` (scopes, webhooks, URLs):

1. Update the TOML file
2. Run `shopify app deploy`
3. If URLs changed, redeploy your app code to the new URL first

## Troubleshooting

### Error: "App URL mismatch"

**Solution:** Ensure the URL in `shopify.app.toml` matches your deployed URL, then run `shopify app deploy`.

### Error: "Invalid redirect URI"

**Solution:** Update `redirect_urls` in `shopify.app.toml` to match your deployed callback URL, then run `shopify app deploy`.

### Error: "Missing environment variable"

**Solution:** Verify all required environment variables are set in your hosting provider's environment settings.

### Session token verification fails

**Solution:**
1. Check `SHOPIFY_API_SECRET` is correctly set in production
2. Verify `SHOPIFY_API_KEY` matches Partner Dashboard
3. Ensure App Bridge script is loading from Shopify CDN

### Build fails

**Solution:**
1. Check all environment variables are set
2. Run `npm install` to ensure dependencies are up to date
3. Check for TypeScript errors: `npm run build`

## Support

For more help:
- [Shopify App CLI Documentation](https://shopify.dev/docs/apps/tools/cli)
- [Shopify Partner Community](https://community.shopify.com/c/shopify-apis-and-sdks/bd-p/shopify-apis-and-technology)
- [Next.js Deployment Documentation](https://nextjs.org/docs/deployment)

## Next Steps

After successful deployment:

1. **Test thoroughly** on development stores
2. **Submit for app review** (if publishing to App Store)
3. **Monitor logs** and error rates
4. **Set up monitoring** (Sentry, LogRocket, etc.)
5. **Document any custom setup** for your team
