// TypeScript declarations for Shopify Polaris App Home web components
// These custom elements are part of the Polaris App Home framework
// Documentation: https://shopify.dev/docs/apps/build/app-home

import React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // Main page container
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-page
      "s-page": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        heading?: string;
        inlineSize?: "small" | "base" | "large";
      };

      // Generic layout container
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-box
      "s-box": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        padding?: string;
        gap?: string;
      };

      // Button component
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-button
      "s-button": React.DetailedHTMLProps<
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        HTMLButtonElement
      > & {
        slot?: string;
        variant?: "auto" | "primary" | "secondary" | "tertiary";
        tone?: "critical" | "auto" | "neutral";
        icon?: string;
      };

      // Section container for grouping content
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-section
      "s-section": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        accessibilityLabel?: string;
        heading?: string;
        padding?: "base" | "none";
      };

      // Grid layout container
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-grid
      "s-grid": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        gap?: string;
        justifyItems?: string;
        alignItems?: string;
        columns?: string;
      };

      // Heading text component
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-heading
      "s-heading": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        level?: "1" | "2" | "3" | "4" | "5" | "6";
      };

      // Paragraph text component
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-paragraph
      "s-paragraph": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;

      // Card component for content containers
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-card
      "s-card": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        padding?: string;
      };

      // Stack layout for vertical or horizontal arrangement
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-stack
      "s-stack": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        gap?: string;
        direction?: "horizontal" | "vertical";
        align?: "start" | "center" | "end" | "stretch";
      };

      // Divider for visual separation
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-divider
      "s-divider": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;

      // Text component for inline text
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-text
      "s-text": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        variant?: "body" | "heading" | "code";
        tone?: "subdued" | "critical" | "success" | "caution";
      };

      // List component
      // Documentation: https://shopify.dev/docs/api/app-home/components/s-list
      "s-list": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        type?: "bullet" | "number";
      };

      // List item component
      "s-list-item": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};
