// head.js
(function applySharedHead() {
  const head = document.head;

  // Preconnects
  const pre1 = document.createElement("link");
  pre1.rel = "preconnect";
  pre1.href = "https://fonts.googleapis.com";
  head.appendChild(pre1);

  const pre2 = document.createElement("link");
  pre2.rel = "preconnect";
  pre2.href = "https://fonts.gstatic.com";
  pre2.crossOrigin = "anonymous";
  head.appendChild(pre2);

  // Fonts - Montserrat for headlines (weights 600/700, matching
  // actual usage across style.css), Rubik for body text (weights
  // 400/500/700, matching prior usage) - both confirmed to support
  // Cyrillic, unlike the previous Clash Display/Satoshi pairing
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href =
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Rubik:wght@400;500;700&display=swap";
  head.appendChild(fonts);

  // Favicons
  const darkIcon = document.createElement("link");
  darkIcon.rel = "icon";
  darkIcon.media = "(prefers-color-scheme: dark)";
  darkIcon.href = "/assets/images/favicon/favicon-dark.png";
  head.appendChild(darkIcon);

  const darkFallbackIcon = document.createElement("link");
  darkFallbackIcon.rel = "icon";
  darkFallbackIcon.media = "not all and (prefers-color-scheme: light)";
  darkFallbackIcon.href = "/assets/images/favicon/favicon-dark.png";
  head.appendChild(darkFallbackIcon);

  const lightIcon = document.createElement("link");
  lightIcon.rel = "icon";
  lightIcon.media = "(prefers-color-scheme: light)";
  lightIcon.href = "/assets/images/favicon/favicon-light.png";
  head.appendChild(lightIcon);

  const touchIcon = document.createElement("link");
  touchIcon.rel = "apple-touch-icon";
  touchIcon.href = "/assets/images/favicon/touch-icon.png";
  head.appendChild(touchIcon);
})();