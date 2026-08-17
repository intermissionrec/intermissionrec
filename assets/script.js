// Load shared head from head.html
async function loadSharedHead(path = './assets/head.html') {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load shared head: ${response.status}`);

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(`<head>${html}</head>`, 'text/html');
    const incomingNodes = [...parsed.head.children];

    incomingNodes.forEach(node => {
      const cloned = node.cloneNode(true);

      if (cloned.tagName === 'TITLE') {
        document.title = cloned.textContent || document.title;
        return;
      }

      const signature = cloned.outerHTML;
      const exists = [...document.head.children].some(
        existing => existing.outerHTML === signature
      );
      if (!exists) {
        document.head.appendChild(cloned);
      }
    });
  } catch (error) {
    console.error(error);
  }
}

// HTML includes for header/footer (data-include="header.html"/"footer.html")
async function includeHtmlFragments() {
  const targets = document.querySelectorAll('[data-include]');
  const promises = [];

  targets.forEach(target => {
    const src = target.getAttribute('data-include');
    if (!src) return;

    const p = fetch(src, { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error(`Failed to load ${src}: ${resp.status}`);
        return resp.text();
      })
      .then(html => {
        target.innerHTML = html;
      })
      .catch(err => console.error(err));

    promises.push(p);
  });

  return Promise.all(promises);

}

// Nav + active section logic
let navLinks = [];
let sections = [];

function computeNavAndSections() {
  navLinks = [...document.querySelectorAll('.nav a')];

  sections = navLinks
    .map(link => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return null;
      return document.querySelector(href);
    })
    .filter(Boolean);

  // Wire click behavior for in-page anchors
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return; // external page; let browser handle

      navLinks.forEach(item => item.classList.remove('is-active'));
      link.classList.add('is-active');
    });
  });
}

// Mobile nav: floating toggle button opens/closes a centered overlay
// menu with a dimmed backdrop. No-op on desktop since the toggle
// button and backdrop stay hidden via CSS above the mobile breakpoint.
function setupMobileNav() {
  const toggle = document.querySelector('.mobile-nav-toggle');
  const navWrap = document.querySelector('.nav-wrap');
  const backdrop = document.querySelector('.mobile-nav-backdrop');
  if (!toggle || !navWrap || !backdrop) return;

  function closeMenu() {
    navWrap.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    navWrap.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => {
    if (navWrap.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  backdrop.addEventListener('click', closeMenu);

  navWrap.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
}

const setActiveLink = () => {
  if (!sections.length) return;

  const offset = window.innerHeight * 0.25;
  let currentId = '';

  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= offset && rect.bottom >= offset) {
      currentId = `#${section.id}`;
    }
  });

  navLinks.forEach(link => {
    link.classList.toggle('is-active', link.getAttribute('href') === currentId);
  });
};

// Prevent right-click "Save Image As..." on any image - uses event
// delegation on document so it also covers images added dynamically
// later (e.g. cover art populated into the artist/smart-link modals
// after a click), not just images present at initial page load.
// Note: this is a deterrent only, same as the CSS drag-prevention -
// it doesn't provide real protection against someone determined to
// extract an image via browser dev tools.
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // 2. Load header/footer partials
  await includeHtmlFragments();

  // 3. Now the .nav exists, so compute nav and sections
  computeNavAndSections();
  setupMobileNav();
  setActiveLink();

  window.addEventListener('scroll', setActiveLink, { passive: true });
  window.addEventListener('resize', setActiveLink);
  window.addEventListener('load', setActiveLink);

  const currentYear = new Date().getFullYear();
  document.querySelectorAll(".year").forEach(el => {
    el.textContent = currentYear + " © INTER(MISSION)";
  });

  setupPageTransitionLinks();
});

// ── Page transitions ───────────────────────────────────────────
// Full-screen black overlay with the logo, present in every page's
// static HTML (not injected here) so it covers the page with zero
// flash on load. Only the header logo and main nav links (excluding
// Discord, which leaves the site) trigger a transition - smart link
// cards, music cards, artist tiles, and external/contact links are
// deliberately left alone.
const pageTransitionOverlay = document.getElementById('pageTransitionOverlay');

function playEntranceTransition() {
  if (!pageTransitionOverlay) return;
  pageTransitionOverlay.classList.add('is-animating');
  setTimeout(() => {
    pageTransitionOverlay.classList.add('is-hidden');
  }, 700);
}

function isPageTransitionLink(link) {
  if (!link) return false;
  if (link.classList.contains('hero-logo-link')) return true;
  if (link.closest('.nav') && !link.classList.contains('nav-discord')) return true;
  return false;
}

function setupPageTransitionLinks() {
  if (!pageTransitionOverlay) return;

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!isPageTransitionLink(link)) return;
    // let ctrl/cmd/shift-click and middle-click open in a new tab normally
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    const href = link.getAttribute('href');
    if (!href) return;

    e.preventDefault();

    pageTransitionOverlay.classList.remove('is-hidden');
    pageTransitionOverlay.classList.remove('is-animating');
    void pageTransitionOverlay.offsetWidth; // restart the animation
    pageTransitionOverlay.classList.add('is-animating');

    setTimeout(() => {
      window.location.href = href;
    }, 550);
  });
}

playEntranceTransition();