// head.js
(function applySharedHead() {
  const head = document.head;

  // Title
  document.title = "INTER(MISSION)";

  // Description
  const metaDesc = document.createElement("meta");
  metaDesc.name = "description";
  metaDesc.content = "INTER(MISSION) - Български музикален хип-хоп проект.";
  head.appendChild(metaDesc);

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

  // Fonts
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Inter+Tight:wght@600&display=swap";
  head.appendChild(fonts);

  // Favicons
  const lightIcon = document.createElement("link");
  lightIcon.rel = "icon";
  lightIcon.media = "not all and (prefers-color-scheme: light)";
  lightIcon.href =
    "./assets/images/favicon/favicon-light.png";
  head.appendChild(lightIcon);

  const darkIcon = document.createElement("link");
  darkIcon.rel = "icon";
  darkIcon.media = "(prefers-color-scheme: dark)";
  darkIcon.href =
    "./assets/images/favicon/favicon-dark.png";
  head.appendChild(darkIcon);

  const touchIcon = document.createElement("link");
  touchIcon.rel = "apple-touch-icon";
  touchIcon.href =
    "./assets/images/favicon/touch-icon.png";
  head.appendChild(touchIcon);
})();