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

// ── Floating header: densifies slightly once the page has scrolled,
// purely cosmetic (see body.header-scrolled in style.css). ──────────
function setupHeaderScrollState() {
  const update = () => {
    document.body.classList.toggle('header-scrolled', window.scrollY > 40);
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
}

// ── Homepage releases marquee ─────────────────────────────────────
// Single row that idle-drifts right-to-left on its own, can be
// grabbed and dragged (mouse or touch) with a momentum "coast" after
// release, and pauses entirely on hover or keyboard focus. The track
// markup is duplicated once in the HTML so the loop can wrap
// seamlessly at the halfway point with no visible jump.
function setupReleasesMarquee() {
  const viewport = document.getElementById('releasesMarquee');
  const track = document.getElementById('releasesMarqueeTrack');
  if (!viewport || !track) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The track's own children are duplicated once in the HTML - clone
  // them again here so there's always at least a 3rd copy ahead,
  // which keeps the wrap seamless even on very wide/short-catalog
  // viewports where two copies alone might not fill the screen.
  const originalChildren = [...track.children];
  originalChildren.forEach(child => track.appendChild(child.cloneNode(true)));

  let x = 0;
  const idleSpeed = 0.55;
  let velocity = 0;
  let isDragging = false;
  let isHovering = false;
  let startClientX = 0;
  let startTranslate = 0;
  let lastClientX = 0;
  let lastTime = 0;
  let totalMoved = 0;
  let halfWidth = 0;

  function measure() {
    halfWidth = track.scrollWidth / 2;
  }
  measure();
  window.addEventListener('resize', measure);

  function wrap() {
    if (halfWidth <= 0) return;
    if (x <= -halfWidth) x += halfWidth;
    if (x > 0) x -= halfWidth;
  }

  function render() {
    track.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  function frame() {
    if (!isDragging) {
      if (Math.abs(velocity) > 0.02) {
        x += velocity;
        velocity *= 0.945;
      } else {
        velocity = 0;
        if (!isHovering && !prefersReducedMotion) {
          x -= idleSpeed;
        }
      }
      wrap();
      render();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function pointerDown(e) {
    isDragging = true;
    velocity = 0;
    totalMoved = 0;
    viewport.classList.add('is-dragging');
    startClientX = e.clientX;
    startTranslate = x;
    lastClientX = startClientX;
    lastTime = performance.now();
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
  }

  function pointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startClientX;
    x = startTranslate + dx;

    const now = performance.now();
    const dt = Math.max(now - lastTime, 1);
    velocity = ((e.clientX - lastClientX) / dt) * 16;
    totalMoved += Math.abs(e.clientX - lastClientX);
    lastClientX = e.clientX;
    lastTime = now;

    wrap();
    render();
  }

  function pointerUp() {
    isDragging = false;
    viewport.classList.remove('is-dragging');
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerUp);

    // A real drag shouldn't also fire the card's link navigation -
    // swallow the very next click on the track if the pointer moved
    // more than a few px, then get out of the way for normal taps.
    if (totalMoved > 6) {
      const suppressClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      track.addEventListener('click', suppressClick, { capture: true, once: true });
    }
  }

  viewport.addEventListener('pointerdown', pointerDown);
  viewport.addEventListener('mouseenter', () => { isHovering = true; });
  viewport.addEventListener('mouseleave', () => { isHovering = false; });
  viewport.addEventListener('focusin', () => { isHovering = true; });
  viewport.addEventListener('focusout', () => { isHovering = false; });
}

// ── Homepage Instagram feed ───────────────────────────────────────
// Reads a static JSON snapshot the release publisher tool bakes into
// the repo at publish time using its existing Graph API credentials -
// the access token itself never ships to the browser.
async function setupInstagramFeed() {
  const grid = document.getElementById('igFeedGrid');
  if (!grid) return;

  try {
    const res = await fetch('./assets/data/instagram-feed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load Instagram feed: ${res.status}`);
    const posts = await res.json();

    grid.innerHTML = posts.slice(0, 12).map(post => {
      const label = (post.caption || 'Instagram post').replace(/"/g, '&quot;');
      return `
        <a class="ig-feed-item" href="${post.permalink}" target="_blank" rel="noopener noreferrer" aria-label="${label}">
          <img src="${post.thumbnail}" alt="" loading="lazy">
        </a>
      `;
    }).join('');
  } catch (error) {
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 2. Load header/footer partials
  await includeHtmlFragments();
  // Signals that .hero-logo-link etc. now actually exist in the DOM -
  // logo3d.js waits for this before querying for them, since it runs
  // independently and would otherwise race against this async fetch.
  document.dispatchEvent(new CustomEvent('header-ready'));

  // 3. Now the .nav exists, so compute nav and sections
  computeNavAndSections();
  setupMobileNav();
  setActiveLink();
  setupHeaderScrollState();

  window.addEventListener('scroll', setActiveLink, { passive: true });
  window.addEventListener('resize', setActiveLink);
  window.addEventListener('load', setActiveLink);

  // 3b. Homepage-only widgets - both are no-ops if their markup isn't
  // present on the current page.
  setupReleasesMarquee();
  setupInstagramFeed();

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
  // Waits for both the original minimum delay and the 3D model being
  // ready (exposed globally by logo3d.js) - unlike the old static PNG,
  // the model loads over the network, so without this the overlay
  // could hide before the logo has actually appeared in it. Capped by
  // a race against a hard maximum so a slow or failed fetch never
  // leaves the overlay stuck indefinitely.
  const modelReady = window.__logoModelReady || Promise.resolve();
  const minDelay = new Promise((resolve) => setTimeout(resolve, 700));
  const maxWait = new Promise((resolve) => setTimeout(resolve, 2500));
  Promise.race([
    Promise.all([modelReady.catch(() => {}), minDelay]),
    maxWait,
  ]).then(() => {
    pageTransitionOverlay.classList.add('is-hidden');
  });
}

function isPageTransitionLink(link) {
  if (!link) return false;
  if (link.classList.contains('hero-logo-link')) return true;
  if (link.closest('.nav')) return true;
  if (link.classList.contains('cover-card')) return true;
  if (link.classList.contains('release-marquee-card')) return true;
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
playEntranceTransition();

window.addEventListener('pageshow', (event) => {
  if (event.persisted && pageTransitionOverlay) {
    pageTransitionOverlay.classList.add('is-hidden');
  }
});