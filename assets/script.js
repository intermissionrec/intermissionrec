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
// Builds the logo's 3D-extrusion illusion by stacking several
// identical copies of it a few pixels apart in Z space (like very
// thin pages in a book). Combined with transform-style: preserve-3d
// on the wrapper, rotating that wrapper reveals the actual "thickness"
// of this stack as a real side profile, rather than simulating depth
// with a flat image and a fake lighting animation.
// Builds the 3D-extrusion illusion by stacking several identical
// copies of a logo image a few pixels apart in Z space (like very
// thin pages in a book). Combined with transform-style: preserve-3d
// on the wrapper, rotating that wrapper reveals the actual geometric
// "thickness" of this stack as a real side profile, rather than
// simulating depth with a flat image. Shared by both the header logo
// (hover-triggered) and the page-transition logo (continuous spin).
function buildLogoDepthLayers(wrap, front, layerClass, layerCount, useShading, spacing, useBlur) {
  spacing = spacing || 1;
  for (let i = 1; i <= layerCount; i++) {
    const layer = front.cloneNode(true);
    layer.className = layerClass;
    layer.removeAttribute('width');
    layer.removeAttribute('height');
    layer.setAttribute('aria-hidden', 'true');
    layer.alt = '';
    layer.style.transform = `translateZ(${-i * spacing}px)`;
    const filters = [];
    if (useShading) {
      const midpoint = (layerCount + 1) / 2;
      const distanceFromMid = Math.abs(i - midpoint) / midpoint; // 0 at middle, ~1 at either end
      const brightnessValue = 0.4 + 0.6 * distanceFromMid; // grey (0.4) at middle, white (1.0) at both ends
      filters.push(`brightness(${brightnessValue})`);
    }
    if (useBlur) filters.push('blur(0.4px)');
    if (filters.length) layer.style.filter = filters.join(' ');
    wrap.insertBefore(layer, front);
  }
}

function setupLogo3D() {
  // Desktop-only - some mobile browsers simulate mouseenter/hover on
  // tap for compatibility with desktop-oriented sites, which could
  // trigger this unintentionally when someone just taps the logo to
  // navigate home.
  if (window.matchMedia('(max-width: 919.98px)').matches) return;

  const wrap = document.querySelector('.hero-logo-3d');
  const front = wrap ? wrap.querySelector('.hero-logo') : null;
  if (!wrap || !front) return;

  buildLogoDepthLayers(wrap, front, 'hero-logo-depth-layer', 10, true, 1.5, false);

  const link = document.querySelector('.hero-logo-link');
  if (!link) return;

  // Deliberately no mouseleave handler at all - the only thing that
  // ever removes is-spinning is the rotation's own animationend
  // event, so once started, the spin always plays out in full
  // regardless of where the mouse goes in the meantime.
  link.addEventListener('mouseenter', () => {
    if (!wrap.classList.contains('is-spinning')) {
      wrap.classList.add('is-spinning');
    }
  });

  wrap.addEventListener('animationend', (e) => {
    if (e.target !== wrap) return;
    wrap.classList.remove('is-spinning');
  });
}

// The page-transition overlay's logo spins continuously (not a
// one-shot hover effect), and - since a page transition is a genuine
// browser navigation between two entirely separate page loads, with
// no JS state naturally surviving that boundary - its rotation
// position is persisted across that boundary via sessionStorage. A
// single fixed "virtual start timestamp" is stored once and reused on
// every subsequent page; each page just calculates how far into the
// infinite loop that timestamp implies *right now* using real
// wall-clock time, then applies that as a negative animation-delay so
// the spin appears to continue seamlessly - including accounting for
// however long the actual page load itself took, not just time spent
// on each individual page.
const TRANSITION_SPIN_LOOP_MS = 2000;

function setupTransitionLogoSpin() {
  if (!pageTransitionOverlay) return;

  const wrap = document.createElement('div');
  wrap.className = 'page-transition-logo-3d';

  const front = document.createElement('img');
  front.className = 'page-transition-logo';
  // Absolute URL - this element is now built entirely in JS rather
  // than living in each page's own HTML, so there's no per-page
  // relative path (./ vs ../) available to reference here.
  front.src = 'https://intermissionrec.com/assets/images/logo/intermission-logo.png';
  front.alt = '';

  wrap.appendChild(front);
  pageTransitionOverlay.appendChild(wrap);

  // Fewer layers and no per-layer shading filter compared to the
  // header logo's hover effect - this spins continuously for as long
  // as the overlay is visible (not a brief one-shot animation), so
  // it's worth trimming the ongoing rendering cost, especially since
  // this runs right during the most contended moment of page load.
  buildLogoDepthLayers(wrap, front, 'transition-logo-depth-layer', 10, false, 1.5, false);

  let startTs = parseInt(sessionStorage.getItem('logoSpinStart') || '', 10);
  if (!startTs) {
    startTs = Date.now();
    sessionStorage.setItem('logoSpinStart', String(startTs));
  }

  const elapsed = Date.now() - startTs;
  const offsetInLoop = elapsed % TRANSITION_SPIN_LOOP_MS;
  wrap.style.animationDelay = `-${offsetInLoop}ms`;
}

function setupMobileNav() {
  const toggle = document.querySelector('.mobile-nav-toggle');
  const navWrap = document.querySelector('.nav-wrap');
  const backdrop = document.querySelector('.mobile-nav-backdrop');
  if (!toggle || !navWrap || !backdrop) return;

  // nav-wrap and the backdrop need relocating on mobile - on desktop,
  // .nav-wrap already works correctly in its original position (a
  // sticky top bar within the header), and moving it out to body
  // would place it after the footer in DOM order, breaking that
  // entirely. The relocation only exists to keep these pieces outside
  // .page's blur filter, since the menu overlay itself should stay
  // sharp while open - not needed on desktop at all.
  const isMobile = window.matchMedia('(max-width: 919.98px)').matches;
  if (isMobile) {
    document.body.appendChild(navWrap);
    document.body.appendChild(backdrop);
  }

  // The toggle button normally stays inside the header, blurring
  // naturally along with everything else when a card modal opens.
  // But while the *menu itself* is open, it needs to stay outside
  // .page's blur so it remains visible and clickable to close the
  // menu - so it's temporarily relocated to body only for that
  // duration, then moved back to its original spot in the header
  // once the menu closes.
  const toggleHomeParent = toggle.parentElement;

  function closeMenu() {
    navWrap.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.body.classList.remove('nav-open');
    if (isMobile && toggleHomeParent) toggleHomeParent.appendChild(toggle);
  }

  function openMenu() {
    navWrap.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('nav-open');
    if (isMobile) document.body.appendChild(toggle);
  }

  toggle.addEventListener('click', () => {
    if (navWrap.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  backdrop.addEventListener('click', closeMenu);

  // Deliberately NOT closing on nav link clicks: every nav link now
  // triggers the page transition overlay, which sits at a much higher
  // z-index and will fully cover this menu once it fades in, then the
  // whole page navigates away anyway. Closing this menu independently
  // on click created a visible gap - its own fade-out finishing before
  // the transition overlay had fully faded in, briefly showing the
  // real page underneath.
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

// The CSS -webkit-user-drag property only covers Chrome/Safari/Edge -
// Firefox never implemented it at all. The standard, cross-browser way
// to block image dragging is the HTML draggable attribute itself.
// dragstart is used (rather than setting draggable="false" once at
// load) so it also covers images added dynamically later, same as the
// contextmenu listener above.
document.addEventListener('dragstart', (e) => {
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
  setupLogo3D();
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
// flash on load. The header logo and every main nav link (including
// Discord) trigger a transition - smart link cards, music cards,
// artist tiles, and contact links are deliberately left alone.
const pageTransitionOverlay = document.getElementById('pageTransitionOverlay');

function playEntranceTransition() {
  if (!pageTransitionOverlay) return;
  setTimeout(() => {
    pageTransitionOverlay.classList.add('is-hidden');
  }, 700);
}

function isPageTransitionLink(link) {
  if (!link) return false;
  if (link.classList.contains('hero-logo-link')) return true;
  if (link.closest('.nav')) return true;
  if (link.classList.contains('cover-card')) return true;
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

    // clicking the home logo while already on the home page shouldn't
    // reload the page or play the transition at all
    if (link.classList.contains('hero-logo-link') && document.body.classList.contains('home')) {
      e.preventDefault();
      return;
    }

    // same idea, generalized to every other nav link: clicking Артисти
    // while already on the artists page (etc.) shouldn't reload either.
    // Each page's <body> already carries a class matching its own name
    // (body.artists, body.music, body.contacts), so comparing the
    // clicked link's destination slug against that tells us if we're
    // already there.
    if (link.closest('.nav')) {
      const slug = href.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop();
      if (slug && document.body.classList.contains(slug)) {
        e.preventDefault();
        return;
      }
    }

    e.preventDefault();

    pageTransitionOverlay.classList.remove('is-hidden');

    setTimeout(() => {
      window.location.href = href;
    }, 550);
  });
}

// Runs immediately (not waiting for DOMContentLoaded/fragments) since
// the overlay element is already present in the page's own static HTML.
setupTransitionLogoSpin();
playEntranceTransition();

window.addEventListener('pageshow', (event) => {
  if (event.persisted && pageTransitionOverlay) {
    pageTransitionOverlay.classList.add('is-hidden');
  }
});