// OAuth scopes required for the Shopify app
// Grouped by functionality for better readability

// Product access
const PRODUCT_SCOPES = [
  "read_products",
  "write_products",
];

// File and content access
const CONTENT_SCOPES = [
  "read_content",
  "write_content",
  "read_files",
  "write_files",
];

// Theme access
const THEME_SCOPES = [
  "read_themes",
  "write_themes",
];

// Online store pages access
const PAGES_SCOPES = [
  "read_online_store_pages",
  "write_online_store_pages",
];

// Navigation access
const NAVIGATION_SCOPES = [
  "read_online_store_navigation",
  "write_online_store_navigation",
];

// Metaobject access
const METAOBJECT_SCOPES = [
  "read_metaobject_definitions",
  "write_metaobject_definitions",
  "read_metaobjects",
  "write_metaobjects",
];

// All scopes combined - used in OAuth request
// Note: Must match SCOPES constant in app/page.tsx
export const ALL_SCOPES = [
  ...PRODUCT_SCOPES,
  ...CONTENT_SCOPES,
  ...THEME_SCOPES,
  ...PAGES_SCOPES,
  ...NAVIGATION_SCOPES,
  ...METAOBJECT_SCOPES,
].join(",");

// Default scopes for session creation (when OAuth scope not provided)
// Uses all scopes to ensure compatibility
export const DEFAULT_SESSION_SCOPE = ALL_SCOPES;
