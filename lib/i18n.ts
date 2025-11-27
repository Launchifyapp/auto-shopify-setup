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
    
    // Privacy policy page
    privacyTitle: "Politique de confidentialité",
    privacyIntroTitle: "Introduction",
    privacyIntroText: "Cette politique de confidentialité décrit comment notre application Shopify gère les données. Nous nous engageons à protéger votre vie privée et à être transparents sur nos pratiques en matière de données.",
    privacyDataTitle: "Données clients collectées",
    privacyDataText: "Notre application ne collecte, ne stocke ni ne traite aucune donnée personnelle des clients de votre boutique. Nous n'avons accès à aucune information client telle que les noms, adresses e-mail, adresses postales ou informations de paiement.",
    privacyMerchantDataTitle: "Données marchands",
    privacyMerchantDataText: "Notre application accède uniquement aux données de configuration de votre boutique nécessaires pour fournir nos services (thèmes, produits, pages). Ces données ne sont utilisées que pendant le processus d'installation et ne sont pas stockées de manière permanente sur nos serveurs.",
    privacyGDPRTitle: "Conformité RGPD et droits sur les données",
    privacyGDPRText: "Conformément au RGPD, au CCPA et aux autres lois sur la protection des données, vous avez le droit de demander l'accès, la rectification ou la suppression de vos données. Étant donné que nous ne stockons aucune donnée personnelle, ces demandes n'entraîneront aucune action de notre part, mais nous confirmerons que nous ne détenons aucune de vos données.",
    privacyContactTitle: "Nous contacter",
    privacyContactText: "Si vous avez des questions concernant cette politique de confidentialité ou nos pratiques en matière de données, veuillez nous contacter à launchify.business@gmail.com :",
    privacyLastUpdated: "Dernière mise à jour : Novembre 2025",
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
    
    // Privacy policy page
    privacyTitle: "Privacy Policy",
    privacyIntroTitle: "Introduction",
    privacyIntroText: "This privacy policy describes how our Shopify app handles data. We are committed to protecting your privacy and being transparent about our data practices.",
    privacyDataTitle: "Customer Data Collected",
    privacyDataText: "Our app does not collect, store, or process any personal data from your store's customers. We do not have access to any customer information such as names, email addresses, mailing addresses, or payment information.",
    privacyMerchantDataTitle: "Merchant Data",
    privacyMerchantDataText: "Our app only accesses store configuration data necessary to provide our services (themes, products, pages). This data is only used during the installation process and is not permanently stored on our servers.",
    privacyGDPRTitle: "GDPR Compliance and Data Rights",
    privacyGDPRText: "In accordance with GDPR, CCPA, and other data protection laws, you have the right to request access, rectification, or deletion of your data. Since we do not store any personal data, these requests will result in no action on our part, but we will confirm that we hold none of your data.",
    privacyContactTitle: "Contact Us",
    privacyContactText: "If you have any questions about this privacy policy or our data practices, please contact us at launchify.business@gmail.com:",
    privacyLastUpdated: "Last updated: November 2025",
  }
};

export function t(lang: Language, key: keyof typeof translations.fr): string {
  return translations[lang][key] || translations.fr[key];
}
