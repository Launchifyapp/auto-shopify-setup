const path = require('path');

module.exports = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      // '@' -> racine du projet
      '@': path.resolve(__dirname),
      // '@/lib' -> ./lib
      '@/lib': path.resolve(__dirname, 'lib'),
    };
    return config;
  },
};
