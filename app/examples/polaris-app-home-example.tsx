/**
 * Example: Using Polaris App Home Web Components
 * 
 * This example demonstrates how to use Shopify Polaris App Home web components
 * in a TypeScript/Next.js application. These custom elements are now fully
 * typed and will not produce TypeScript compilation errors.
 * 
 * @see https://shopify.dev/docs/apps/build/app-home
 */

import React from "react";

export default function PolarisAppHomeExample() {
  const handlePrimaryAction = () => {
    console.log("Primary action clicked");
  };

  const handleSecondaryAction = () => {
    console.log("Secondary action clicked");
  };

  return (
    <s-page heading="Welcome to My Shopify App" inlineSize="base">
      {/* Primary action button in page header */}
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handlePrimaryAction}
      >
        Create New Product
      </s-button>

      {/* Main content section */}
      <s-section heading="Getting Started" padding="base">
        <s-box padding="4" gap="4">
          <s-heading level="2">Quick Start Guide</s-heading>
          <s-paragraph>
            Follow these steps to set up your store and start selling.
          </s-paragraph>

          {/* Grid layout with cards */}
          <s-grid columns="3" gap="4">
            <s-card padding="4">
              <s-stack gap="2" direction="vertical">
                <s-heading level="3">Step 1</s-heading>
                <s-text variant="body" tone="subdued">
                  Configure your store settings
                </s-text>
              </s-stack>
            </s-card>

            <s-card padding="4">
              <s-stack gap="2" direction="vertical">
                <s-heading level="3">Step 2</s-heading>
                <s-text variant="body" tone="subdued">
                  Add your products
                </s-text>
              </s-stack>
            </s-card>

            <s-card padding="4">
              <s-stack gap="2" direction="vertical">
                <s-heading level="3">Step 3</s-heading>
                <s-text variant="body" tone="subdued">
                  Launch your store
                </s-text>
              </s-stack>
            </s-card>
          </s-grid>

          <s-divider />

          {/* List example */}
          <s-box>
            <s-heading level="3">Features</s-heading>
            <s-list type="bullet">
              <s-list-item>Automated product creation</s-list-item>
              <s-list-item>Inventory management</s-list-item>
              <s-list-item>Real-time analytics</s-list-item>
            </s-list>
          </s-box>

          {/* Action buttons */}
          <s-stack gap="3" direction="horizontal">
            <s-button variant="secondary" onClick={handleSecondaryAction}>
              Learn More
            </s-button>
            <s-button variant="tertiary">
              View Documentation
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* Additional section */}
      <s-section heading="Recent Activity" padding="base">
        <s-box padding="4">
          <s-text variant="body" tone="subdued">
            No recent activity to display.
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}
