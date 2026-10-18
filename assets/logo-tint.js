/* logo-tint.js - homepage only.
 *
 * Tints the header logo with the most prominent colour of the feature
 * slide that's currently showing - made darker or lighter, whichever
 * keeps it readable against the part of the image sitting behind the
 * logo - and blends it back to the standard white as the visitor
 * scrolls down past the slides.
 *
 * How it works:
 *  - Watches the carousel for the .is-active slide changing (it only
 *    looks at the class, so it doesn't depend on how script.js runs
 *    the carousel).
 *  - Samples the slide's image (the part of it that's actually visible,
 *    allowing for background-size: cover and the data-photo-x/y focal
 *    point) and finds the dominant colour.
 *  - Measures how bright the image is directly behind the logo. Bright
 *    background -> the logo's colour is darkened; dark background -> it
 *    is lightened, until there is enough contrast (MIN_CONTRAST).
 *  - Sets --logo-tint on <html>, plus --logo-tint-amount (1 at the top of
 *    the page -> 0 once you've scrolled FADE_FRACTION of the way down
 *    the feature band).
 *  - The actual colouring and the smooth transitions live in style.css
 *    (search for "Homepage logo tint").
 *
 * If anything here fails (image won't load, canvas blocked, no logo on
 * the page...), the logo simply stays its normal white.
 */
(function () {
  'use strict';

  // ── Tunables ────────────────────────────────────────────────────
  var SAMPLE_WIDTH = 64;        // image is shrunk to this many px wide before sampling
  var HUE_BUCKETS = 24;         // colours are grouped into this many hue slices
  var MIN_COLORFULNESS = 0.04;  // below this the image counts as grey (logo goes white/near-black)
  var MIN_SATURATION = 0.3;    // the picked colour is pushed up to at least this vividness
  var MIN_CONTRAST = 3.5;         // contrast ratio to reach against the image behind the logo (3 = bare minimum, 4.5 = text-grade)
  var MIN_LIGHTNESS = 0.08;     // how dark the logo may get
  var MAX_LIGHTNESS = 0.94;     // how light the logo may get
  var HEADER_SCRIM = 0.26;      // how much the header's own dark fade dims the image behind the logo at the top of the page
  var FADE_FRACTION = 0.55;     // share of the feature band's height over which it fades to white
  var WHITE = '#ffffff';
  var DARK = 'rgb(12, 12, 12)'; // logo colour on a bright grey image

  var root = document.documentElement;
  var carousel = document.querySelector('.feature-carousel');
  var band = document.querySelector('.feature-band');
  if (!carousel || !band) return;

  // ── Colour helpers ──────────────────────────────────────────────
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    if (s === 0) { var v = Math.round(l * 255); return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(hue(p, q, h + 1 / 3) * 255),
      Math.round(hue(p, q, h) * 255),
      Math.round(hue(p, q, h - 1 / 3) * 255)
    ];
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // WCAG relative luminance (0 = black, 1 = white) of an sRGB colour.
  function channelToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function luminance(r, g, b) {
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
  }
  function contrast(l1, l2) {
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  // Below this luminance white text reads better than black, above it black does.
  var CROSSOVER = Math.sqrt(1.05 * 0.05) - 0.05; // ~0.179

  // ── Finding the slide's image and its visible area ──────────────
  function slideImageUrl(slide) {
    var raw = getComputedStyle(slide).getPropertyValue('--feature-image') ||
      slide.style.getPropertyValue('--feature-image');
    var m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(raw || '');
    return m ? new URL(m[2], document.baseURI).href : null;
  }

  var imageCache = new Map();
  function loadImage(url) {
    if (!imageCache.has(url)) {
      imageCache.set(url, new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { resolve(null); };
        img.src = url;
      }));
    }
    return imageCache.get(url);
  }

  function focalPoint(slide, name) {
    var n = parseFloat(slide.dataset[name]);
    return clamp(isNaN(n) ? 50 : n, 0, 100) / 100;
  }

  // The part of the image the band actually shows (background-size: cover).
  function visibleRect(img, slide) {
    var bw = band.clientWidth || window.innerWidth;
    var bh = band.clientHeight || window.innerHeight;
    var scale = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
    var sw = bw / scale, sh = bh / scale;
    return {
      sx: (img.naturalWidth - sw) * focalPoint(slide, 'photoX'),
      sy: (img.naturalHeight - sh) * focalPoint(slide, 'photoY'),
      sw: sw,
      sh: sh,
      bw: bw,
      bh: bh
    };
  }

  // Draws a region of the image into a small canvas and returns its pixels.
  function readPixels(img, sx, sy, sw, sh, cw, ch) {
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    try {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      return ctx.getImageData(0, 0, cw, ch).data;
    } catch (e) {
      return null; // e.g. cross-origin image blocks pixel access
    }
  }

  // ── Dominant colour ─────────────────────────────────────────────
  // Every pixel votes for its hue slice, weighted by how vivid it is
  // (saturation, discounted near black/white), so "prominent" means
  // plenty of area AND real colour - big dark or grey areas don't win.
  // Returns [h, s, l] or null when the image is basically grey.
  function dominantHsl(img, rect) {
    var cw = SAMPLE_WIDTH;
    var ch = Math.max(1, Math.round(cw * rect.sh / rect.sw));
    var data = readPixels(img, rect.sx, rect.sy, rect.sw, rect.sh, cw, ch);
    if (!data) return null;

    var N = HUE_BUCKETS;
    var weight = new Array(N).fill(0);
    var rs = new Array(N).fill(0), gs = new Array(N).fill(0), bs = new Array(N).fill(0);
    var pixels = 0;

    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      pixels++;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var hsl = rgbToHsl(r, g, b);
      var l = hsl[2];
      if (l < 0.1 || l > 0.93) continue;
      var vivid = hsl[1] * (1 - Math.abs(2 * l - 1));
      if (vivid < 0.06) continue;
      var k = Math.floor(hsl[0] * N) % N;
      weight[k] += vivid;
      rs[k] += r * vivid;
      gs[k] += g * vivid;
      bs[k] += b * vivid;
    }
    if (!pixels) return null;

    // Neighbouring hue slices are pooled so a colour straddling a slice
    // boundary isn't split into two weaker votes.
    var best = -1, bestScore = 0;
    for (var j = 0; j < N; j++) {
      var score = weight[j] + 0.5 * (weight[(j + N - 1) % N] + weight[(j + 1) % N]);
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (best < 0 || bestScore / pixels < MIN_COLORFULNESS) return null;

    var tw = 0, tr = 0, tg = 0, tb = 0;
    [-1, 0, 1].forEach(function (o) {
      var idx = (best + o + N) % N;
      tw += weight[idx]; tr += rs[idx]; tg += gs[idx]; tb += bs[idx];
    });
    return rgbToHsl(tr / tw, tg / tw, tb / tw);
  }

  // ── How bright is the image right behind the logo? ──────────────
  function logoRegionInBand() {
    var bandBox = band.getBoundingClientRect();
    var wrap = document.querySelector('.hero-logo-wrap');
    var box = wrap && wrap.getBoundingClientRect();
    if (box && box.width) {
      return {
        x: box.left - bandBox.left,
        y: box.top - bandBox.top,
        w: box.width,
        h: box.height
      };
    }
    // Header not loaded yet: assume the logo sits top-centre.
    var size = parseFloat(getComputedStyle(root).getPropertyValue('--logo-size')) || 96;
    return { x: (band.clientWidth - size) / 2, y: 20, w: size, h: size };
  }

  // Average relative luminance (0-1) of the picture behind the logo, as
  // it looks with the header's own dark fade over it.
  function backgroundLuminance(img, rect) {
    var reg = logoRegionInBand();
    var k = rect.sw / rect.bw;                  // image px per page px
    var sx = clamp(rect.sx + reg.x * k, 0, img.naturalWidth - 1);
    var sy = clamp(rect.sy + reg.y * k, 0, img.naturalHeight - 1);
    var sw = Math.max(1, Math.min(reg.w * k, img.naturalWidth - sx));
    var sh = Math.max(1, Math.min(reg.h * k, img.naturalHeight - sy));
    var data = readPixels(img, sx, sy, sw, sh, 24, 24);
    if (!data) return null;
    var dim = 1 - HEADER_SCRIM, total = 0, n = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      total += luminance(data[i] * dim, data[i + 1] * dim, data[i + 2] * dim);
      n++;
    }
    return n ? total / n : null;
  }

  // ── Choosing the logo colour ────────────────────────────────────
  // Keep the picture's hue, then slide its lightness - darker on a bright
  // background, lighter on a dark one - just far enough to reach
  // MIN_CONTRAST. A grey picture has no hue to keep, so the logo goes
  // plain white on dark pictures and near-black on bright ones.
  function pickLogoColor(hsl, bgLum) {
    var darker = bgLum > CROSSOVER;
    if (!hsl) return darker ? DARK : WHITE;

    var h = hsl[0];
    var s = Math.max(hsl[1], MIN_SATURATION);
    var l = clamp(hsl[2], MIN_LIGHTNESS, MAX_LIGHTNESS);
    var step = darker ? -0.02 : 0.02;
    var rgb = hslToRgb(h, s, l);

    while (contrast(luminance(rgb[0], rgb[1], rgb[2]), bgLum) < MIN_CONTRAST) {
      var next = l + step;
      if (next < MIN_LIGHTNESS || next > MAX_LIGHTNESS) break;
      l = next;
      rgb = hslToRgb(h, s, l);
    }
    return 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')';
  }

  // ── Getting the logo ready (header.html loads after this runs) ──
  function prepareLogo() {
    if (root.classList.contains('logo-tint-ready')) return true;
    var img = document.querySelector('.hero-logo');
    if (!img) return false;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', prepareLogo, { once: true });
      return false;
    }
    root.style.setProperty('--logo-mask-url', 'url("' + (img.currentSrc || img.src) + '")');
    root.classList.add('logo-tint-ready');
    return true;
  }

  function waitForLogo() {
    if (prepareLogo()) return;
    var mo = new MutationObserver(function () {
      if (document.querySelector('.hero-logo')) {
        mo.disconnect();
        prepareLogo();
      }
    });
    mo.observe(document.body || root, { childList: true, subtree: true });
  }

  // ── Applying it ─────────────────────────────────────────────────
  var token = 0;
  function refresh() {
    var slide = carousel.querySelector('.feature-slide.is-active') ||
      carousel.querySelector('.feature-slide');
    if (!slide) return;
    var mine = ++token;
    var url = slideImageUrl(slide);
    (url ? loadImage(url) : Promise.resolve(null)).then(function (img) {
      if (mine !== token) return; // a newer slide change superseded this one
      var color = WHITE;
      if (img) {
        var rect = visibleRect(img, slide);
        var bgLum = backgroundLuminance(img, rect);
        if (bgLum !== null) color = pickLogoColor(dominantHsl(img, rect), bgLum);
      }
      root.style.setProperty('--logo-tint', color);
      updateAmount();
      waitForLogo();
    });
  }

  function updateAmount() {
    var y = window.pageYOffset || root.scrollTop || 0;
    var distance = Math.max(1, band.offsetHeight * FADE_FRACTION);
    var amount = 1 - clamp(y / distance, 0, 1);
    root.style.setProperty('--logo-tint-amount', amount.toFixed(3));
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      updateAmount();
    });
  }, { passive: true });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { refresh(); updateAmount(); }, 200);
  });

  // Follow the carousel: re-run whenever a different slide becomes active.
  var lastActive = null;
  new MutationObserver(function () {
    var active = carousel.querySelector('.feature-slide.is-active');
    if (active && active !== lastActive) {
      lastActive = active;
      refresh();
    }
  }).observe(carousel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  lastActive = carousel.querySelector('.feature-slide.is-active');
  updateAmount();
  refresh();
})();