import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.resolve(process.cwd()),
      "@/lib": path.resolve(process.cwd(), "lib"),
    };
    return config;
  },
};

export default nextConfig;
