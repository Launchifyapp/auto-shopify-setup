export type Language = "fr" | "en";

export const translations = {
  fr: {
    // Landing page (only display language, no store language)
    installTitle: "Installer l'app Shopify automatique",
    installDescription: "Entrez votre nom de boutique Shopify pour lancer l'installation de l'app sur votre store.",
    shopPlaceholder: "votreshop.myshopify.com",
    installButton: "Installer l'app sur Shopify",
    afterInstallMessage: "Après installation, vous pourrez choisir la langue de votre boutique",
    afterInstallDetails: "(pages, produits, thème).",
    invalidShopAlert: "Entrer un shop valide, ex: monboutique.myshopify.com",
    displayLanguage: "Langue d'affichage",
    
    // Store language selection page (after OAuth)
    selectStoreLanguageTitle: "Choisissez la langue de votre boutique",
    selectStoreLanguageDescription: "Sélectionnez la langue dans laquelle vos produits, pages et thème seront créés.",
    selectStoreLanguage: "Langue de la boutique",
    startInstallation: "Démarrer l'installation",
    
    // Loading page
    loadingTitle: "Installation en cours…",
    loadingStep: "Étape {step}/3. Merci de patienter pendant l'automatisation complète de votre boutique Shopify.",
    loadingFallback: "Chargement…",
    missingParams: "Paramètres manquants.",
    errorSetup: "Erreur setup boutique",
    errorThemeUpload: "Erreur upload thème",
    errorThemePublish: "Erreur publication thème",
    generalError: "Erreur générale automatisation",
    
    // Success page
    successTitle: "✅ Installation réussie !",
    successMessage: "Félicitations, votre boutique Shopify a été automatisée.",
    successDetails: "Vous pouvez maintenant personnaliser votre site et commencer à vendre !",
    accessAdmin: "Accéder à l'admin Shopify",
    needHelp: "Si vous avez besoin d'aide,",
    contactSupport: "contactez le support",
    
    // Content (pages, collections, menu)
    shippingPageTitle: "Livraison",
    shippingPageHandle: "livraison",
    shippingPageBody: `Livraison GRATUITE
Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:

France : 4-10 jours ouvrables
Belgique: 4-10 jours ouvrables
Suisse : 7-12 jours ouvrables
Canada : 7-12 jours ouvrables
Reste du monde : 7-14 jours
`,
    menuHome: "Accueil",
    menuProducts: "Nos Produits",
    menuShipping: "Livraison",
    menuContact: "Contact",
    collectionBeauty: "Beauté & soins",
    collectionBeautyHandle: "beaute-soins",
    collectionBeautyTag: "Beauté & soins",
    collectionHome: "Maison & confort",
    collectionHomeHandle: "maison-confort",
    collectionHomeTag: "Maison & confort",
    themeName: "Dreamify V2 FR",
  },
  en: {
    // Landing page (only display language, no store language)
    installTitle: "Install the automatic Shopify app",
    installDescription: "Enter your Shopify store name to start installing the app on your store.",
    shopPlaceholder: "yourshop.myshopify.com",
    installButton: "Install app on Shopify",
    afterInstallMessage: "After installation, you will be able to choose your store language",
    afterInstallDetails: "(pages, products, theme).",
    invalidShopAlert: "Enter a valid shop, e.g.: mystore.myshopify.com",
    displayLanguage: "Display language",
    
    // Store language selection page (after OAuth)
    selectStoreLanguageTitle: "Choose your store language",
    selectStoreLanguageDescription: "Select the language in which your products, pages and theme will be created.",
    selectStoreLanguage: "Store language",
    startInstallation: "Start installation",
    
    // Loading page
    loadingTitle: "Installation in progress…",
    loadingStep: "Step {step}/3. Please wait while we fully automate your Shopify store.",
    loadingFallback: "Loading…",
    missingParams: "Missing parameters.",
    errorSetup: "Store setup error",
    errorThemeUpload: "Theme upload error",
    errorThemePublish: "Theme publish error",
    generalError: "General automation error",
    
    // Success page
    successTitle: "✅ Installation successful!",
    successMessage: "Congratulations, your Shopify store has been automated.",
    successDetails: "You can now customize your site and start selling!",
    accessAdmin: "Access Shopify Admin",
    needHelp: "If you need help,",
    contactSupport: "contact support",
    
    // Content (pages, collections, menu)
    shippingPageTitle: "Shipping",
    shippingPageHandle: "shipping",
    shippingPageBody: `FREE Shipping
Order processing takes 1-3 business days before shipping. Once the item is shipped, estimated delivery time is:

United States: 7-14 business days
United Kingdom: 7-14 business days
Canada: 7-12 business days
Australia: 10-18 business days
Rest of the world: 10-21 business days
`,
    menuHome: "Home",
    menuProducts: "Our Products",
    menuShipping: "Shipping",
    menuContact: "Contact",
    collectionBeauty: "Beauty & Care",
    collectionBeautyHandle: "beauty-care",
    collectionBeautyTag: "Beauty & Care",
    collectionHome: "Home & Comfort",
    collectionHomeHandle: "home-comfort",
    collectionHomeTag: "Home & Comfort",
    themeName: "Dreamify V2 EN",
  }
};

export function t(lang: Language, key: keyof typeof translations.fr): string {
  return translations[lang][key] || translations.fr[key];
}
