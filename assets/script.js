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
// Newsletter signup form (in the footer, present on every page) -
// mirrors the contact form's own hidden-iframe + postMessage pattern
// in contacts.html, generalized here since this one is site-wide
// rather than page-specific.
function setupNewsletterModal() {
  const overlay = document.getElementById('newsletterModalOverlay');
  const closeBtn = document.getElementById('newsletterModalCloseBtn');
  if (!overlay || !closeBtn) return;

  function openModal() {
    overlay.style.display = 'flex';
  }
  function closeModal() {
    overlay.style.display = 'none';
  }

  // Both footer variants (desktop/mobile) have their own trigger button -
  // only one is ever visible at a time via CSS, but both share this class.
  document.querySelectorAll('.newsletter-trigger-btn').forEach((btn) => {
    btn.addEventListener('click', openModal);
  });

  closeBtn.addEventListener('click', closeModal);

  // Clicking the dark backdrop (not the modal card itself) closes it too.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') closeModal();
  });
}

function setupNewsletterForm() {
  const form = document.getElementById('newsletterForm');
  if (!form) return;

  const startTimeField = document.getElementById('newsletterStartTime');
  const submitBtn = document.getElementById('newsletterSubmitBtn');
  const status = document.getElementById('newsletterStatus');
  const originalBtnText = submitBtn.textContent;
  let resetTimer = null;

  startTimeField.value = Date.now();

  function resetButton() {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    submitBtn.textContent = originalBtnText;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  form.addEventListener('submit', () => {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    submitBtn.style.cursor = 'default';
    submitBtn.textContent = '...';
    status.style.display = 'none';

    // Safety net: force a reset after 12 seconds no matter what, in
    // case the Worker's response never arrives at all.
    resetTimer = setTimeout(() => {
      resetButton();
      status.textContent = 'Нещо се обърка - опитай отново.';
      status.style.color = '#e05a4e';
      status.style.display = 'block';
    }, 12000);
  });

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'newsletterSubscribeResult') return;

    resetButton();

    if (event.data.success) {
      form.reset();
      startTimeField.value = Date.now();
      status.textContent = 'Провери имейла си, за да потвърдиш абонамента!';
      status.style.color = '';
      status.style.display = 'block';
    } else {
      status.textContent = 'Нещо се обърка: ' + (event.data.error || 'моля опитай отново');
      status.style.color = '#e05a4e';
      status.style.display = 'block';
    }
  });
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
  // Single source of truth for both the homepage's "latest releases"
  // row and its featured-release carousel: fetches music.html's own
  // grid once and shares the result between both, so adding a
  // release only ever means editing music.html.
  async function fetchMusicPageCards() {
    const res = await fetch('./music/');
    if (!res.ok) throw new Error('Failed to load music page: ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll('.music-grid .music-card');
    if (!cards.length) throw new Error('No releases found on music page');
    return cards;
  }

  function syncHomeLatestReleases(sourceCards) {
    const scroller = document.querySelector('.home-latest-scroller');
    if (!scroller) return; // only relevant on the homepage

    function buildCard(card, hidden) {
      const href = card.getAttribute('href') || '';
      const label = card.getAttribute('aria-label') || '';
      // Read directly from the inline style attribute - resolves
      // correctly here too since --track-image's url() is resolved
      // relative to the shared stylesheet, not the HTML page, so
      // the raw path string can be reused verbatim.
      const trackImage = card.style.getPropertyValue('--track-image');
      const titleEl = card.querySelector('.music-title');
      const titleText = titleEl ? titleEl.textContent : label;

      const a = document.createElement('a');
      a.className = 'music-card';
      a.href = href;
      a.rel = 'noopener noreferrer';
      if (hidden) {
        a.setAttribute('aria-hidden', 'true');
        a.tabIndex = -1;
      } else {
        a.setAttribute('aria-label', label);
      }
      a.style.setProperty('--track-image', trackImage);

      const span = document.createElement('span');
      span.className = 'music-title';
      span.textContent = titleText;
      a.appendChild(span);
      return a;
    }

    const fragment = document.createDocumentFragment();
    sourceCards.forEach((card) => fragment.appendChild(buildCard(card, false)));
    // Duplicate set, hidden from assistive tech/keyboard nav - exists
    // only so the scroll animation can loop seamlessly.
    sourceCards.forEach((card) => fragment.appendChild(buildCard(card, true)));

    scroller.replaceChildren(fragment);
  }

  // Mirrors artists.html's own applyPhotoFraming exactly (same
  // cover-scale + zoom + background-position math) - reused here so
  // feature-slide images support the same manual zoom/position
  // adjustment as artist photos, set via the app's "Adjust Photo"
  // button per slide. A slide with no custom framing data attributes
  // just keeps the plain CSS cover/center default untouched.
  function applyFeatureSlideFraming(slide) {
    const style = slide.getAttribute('style') || '';
    const imgMatch = style.match(/--feature-image:\s*url\('([^']*)'\)/);
    const coverUrl = imgMatch ? imgMatch[1] : '';
    if (!coverUrl) return;

    // The crop control is desktop-only - mobile always stays at the
    // plain default (cover/center), regardless of what's set for
    // desktop, by design preference.
    const isDesktop = window.matchMedia('(min-width: 920px)').matches;
    if (!isDesktop) {
      slide.style.backgroundSize = '';
      slide.style.backgroundPosition = '';
      return;
    }

    const zoomPercent = parseFloat(slide.getAttribute('data-photo-zoom')) || 100;
    let xPercent = parseFloat(slide.getAttribute('data-photo-x'));
    let yPercent = parseFloat(slide.getAttribute('data-photo-y'));
    if (isNaN(xPercent)) xPercent = 50;
    if (isNaN(yPercent)) yPercent = 50;

    // No custom framing on this slide at all - leave the plain CSS
    // background-size:cover; background-position:center default alone.
    if (zoomPercent === 100 && xPercent === 50 && yPercent === 50) {
      slide.style.backgroundSize = '';
      slide.style.backgroundPosition = '';
      return;
    }

    const loader = new Image();
    loader.onload = function () {
      const contW = slide.offsetWidth;
      const contH = slide.offsetHeight;
      const imgW = loader.naturalWidth;
      const imgH = loader.naturalHeight;
      if (!imgW || !imgH || !contW || !contH) return;

      const coverScale = Math.max(contW / imgW, contH / imgH);
      const totalScale = coverScale * (zoomPercent / 100);
      const sizeWidthPercent = (imgW * totalScale / contW) * 100;
      const sizeHeightPercent = (imgH * totalScale / contH) * 100;

      slide.style.backgroundSize = sizeWidthPercent + '% ' + sizeHeightPercent + '%';
      slide.style.backgroundPosition = xPercent + '% ' + yPercent + '%';
    };
    loader.src = coverUrl;
  }

  function initFeatureSlideFraming() {
    const slides = Array.from(document.querySelectorAll('.feature-slide'));
    if (!slides.length) return;
    slides.forEach(applyFeatureSlideFraming);

    // Re-applies on resize since this carousel is always visible
    // (unlike the artist modal, which only opens briefly) - a resize
    // across the 920px breakpoint switches between desktop/mobile
    // framing values, and even a same-side resize can shift the
    // cover-scale math enough to matter.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => slides.forEach(applyFeatureSlideFraming), 150);
    }, { passive: true });
  }
  initFeatureSlideFraming();

  function initFeatureCarousel() {
    const slides = Array.from(document.querySelectorAll('.feature-slide'));
    if (slides.length <= 1) return; // nothing to navigate to - arrows stay hidden

    let current = slides.findIndex((s) => s.classList.contains('is-active'));
    if (current === -1) current = 0;

    // Every slide besides the starting active one begins parked
    // off-screen to the right, ready to slide in from that side the
    // first time it's navigated to.
    slides.forEach((s, i) => {
      if (i !== current) s.style.transform = 'translateX(100%)';
    });

    let isAnimating = false;

    function goTo(targetIndex, direction) {
      if (isAnimating) return; // ignore rapid double-clicks mid-transition
      const newIndex = (targetIndex + slides.length) % slides.length;
      if (newIndex === current) return;

      const outgoing = slides[current];
      const incoming = slides[newIndex];
      isAnimating = true;

      // Snap the incoming slide to its correct starting side instantly
      // (no transition), then force a reflow so the browser registers
      // that position before the transition is re-enabled - otherwise
      // it would animate from wherever it was last parked instead.
      incoming.style.transition = 'none';
      incoming.style.transform = direction > 0 ? 'translateX(100%)' : 'translateX(-100%)';
      incoming.classList.add('is-active');
      void incoming.offsetWidth;
      incoming.style.transition = '';

      requestAnimationFrame(() => {
        outgoing.style.transform = direction > 0 ? 'translateX(-100%)' : 'translateX(100%)';
        incoming.style.transform = 'translateX(0%)';
      });

      function onTransitionEnd(e) {
        if (e.target !== incoming || e.propertyName !== 'transform') return;
        incoming.removeEventListener('transitionend', onTransitionEnd);
        outgoing.classList.remove('is-active');
        // Reset the now off-screen outgoing slide to a neutral parked
        // position, silently (no transition), so it's ready to be an
        // incoming slide again later regardless of which direction
        // it's approached from next time.
        outgoing.style.transition = 'none';
        outgoing.style.transform = 'translateX(100%)';
        void outgoing.offsetWidth;
        outgoing.style.transition = '';
        current = newIndex;
        isAnimating = false;
      }
      incoming.addEventListener('transitionend', onTransitionEnd);
    }

    const prevBtn = document.querySelector('.feature-arrow-prev');
    const nextBtn = document.querySelector('.feature-arrow-next');
    prevBtn.addEventListener('click', () => goTo(current - 1, -1));
    nextBtn.addEventListener('click', () => goTo(current + 1, 1));
    prevBtn.hidden = false;
    nextBtn.hidden = false;
  }
  initFeatureCarousel();

  (async () => {
    try {
      const sourceCards = await fetchMusicPageCards();
      syncHomeLatestReleases(sourceCards);
    } catch (err) {
      // Leave the scroller's existing hardcoded fallback cards in
      // place rather than clearing anything.
      console.warn('Could not sync latest releases from music page, showing fallback:', err);
    }
  })();

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
  setupNewsletterModal();
  setupNewsletterForm();

  // Toggles the "floating popup" header state once scrolled past the
  // very top - see .nav-wrap / body.scrolled in style.css.
  function updateScrolledState() {
    document.body.classList.toggle('scrolled', window.scrollY > 20);
  }
  updateScrolledState();

  window.addEventListener('scroll', setActiveLink, { passive: true });
  window.addEventListener('scroll', updateScrolledState, { passive: true });
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

// Locks the page's own vertical scrollbar for as long as the overlay
// is covering the screen (including its fade transition) - without
// this, navigating between pages of very different heights (e.g. the
// tall homepage) can make the scrollbar appear/disappear WHILE the
// overlay is visible, shifting its centered logo sideways by the
// scrollbar's own width.
function lockScrollForTransition() {
  document.documentElement.style.overflowY = 'hidden';
}
function unlockScrollAfterTransition() {
  document.documentElement.style.overflowY = '';
}

// The overlay is already visible per its own default CSS the instant
// this script runs, so lock immediately, before the browser has a
// chance to settle on whether this page needs a scrollbar.
lockScrollForTransition();

function playEntranceTransition() {
  if (!pageTransitionOverlay) {
    unlockScrollAfterTransition();
    return;
  }
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
    // Waits for the fade-out's own CSS transition to actually finish
    // before unlocking - tied to the real transitionend event rather
    // than a guessed timeout, so it's exact regardless of the CSS
    // transition's own duration, and the scrollbar can't appear until
    // the overlay has genuinely stopped covering the screen.
    function onFadeOutDone(e) {
      if (e.target !== pageTransitionOverlay || e.propertyName !== 'opacity') return;
      pageTransitionOverlay.removeEventListener('transitionend', onFadeOutDone);
      unlockScrollAfterTransition();
    }
    pageTransitionOverlay.addEventListener('transitionend', onFadeOutDone);
  });
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
    lockScrollForTransition();

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
    unlockScrollAfterTransition();
  }
});