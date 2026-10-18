/* logo-tint.js - homepage only.
 *
 * Gives the header logo a washed-out, pastel version of the most
 * prominent colour of the feature slide that's currently showing - still
 * light, just with a note of the slide's colour in it - and blends it
 * back to the standard white as the visitor scrolls down past the slides.
 *
 * How it works:
 *  - Watches the carousel for the .is-active slide changing (it only
 *    looks at the class, so it doesn't depend on how script.js runs
 *    the carousel).
 *  - Samples the slide's image (the part of it that's actually visible,
 *    allowing for background-size: cover and the data-photo-x/y focal
 *    point) and finds the dominant colour.
 *  - Washes that colour out (pushes its lightness up to WASH_LIGHTNESS and
 *    holds its saturation within WASH_SATURATION_MIN/MAX), then - where the
 *    picture behind the logo is bright - darkens it (a translucent black
 *    overlay of up to LIGHT_BG_DARKEN) and adds some saturation back
 *    (LIGHT_BG_SATURATION) so it doesn't disappear into light areas or go grey.
 *    Dark areas keep the plain washed-out colour.
 *  - Every slide's colour is worked out up front (all the images load in
 *    parallel), so when the carousel changes slide the colour starts
 *    changing at that same instant instead of after an image has loaded.
 *  - Eases the logo from its current colour to the new one (a hue sweep
 *    through OKLCH, TRANSITION_MS long) by updating --logo-tint on <html>,
 *    and keeps --logo-tint-amount (1 at the top of the page -> 0 once
 *    you've scrolled FADE_FRACTION of the way down the feature band).
 *  - Desktop only (DESKTOP_QUERY, the same 920px breakpoint as the
 *    header in style.css): on phones/tablets it does nothing and the
 *    logo stays its normal white.
 *  - How the colour is painted onto the logo (a mask over the white logo
 *    PNG) lives in style.css - search for "Homepage logo tint".
 *
 * If anything here fails (image won't load, canvas blocked, no logo on
 * the page...), the logo simply stays its normal white.
 */
(function () {
  'use strict';

  // ── Tunables ────────────────────────────────────────────────────
  var SAMPLE_WIDTH = 64;        // image is shrunk to this many px wide before sampling
  var HUE_BUCKETS = 24;         // colours are grouped into this many hue slices
  var MIN_COLORFULNESS = 0.04;  // below this the image counts as grey (logo stays white)
  var WASH_LIGHTNESS = 0.88;    // how light the logo is (1 = pure white; lower = more colour, more contrast against bright slides)
  var WASH_SATURATION_MIN = 0.4;  // the logo's colour keeps the slide's saturation, held between these two:
  var WASH_SATURATION_MAX = 0.8;  //   min = always a hint of colour, max = never too candy-bright
  var FADE_FRACTION = 0.55;     // share of the feature band's height over which it fades to white
  var LIGHT_BG_DARKEN = 0.4;    // strength of the black overlay on the logo over fully bright areas (0.5 = 50% black)
  var LIGHT_BG_SATURATION = 0.4; // extra colour added back on bright areas, so the darkened logo doesn't turn grey (0 = none)
  var LIGHT_BG_START = 0.15;    // brightness behind the logo (0-1) where that darkening begins...
  var LIGHT_BG_FULL = 0.32;     // ...and where it reaches full strength
  var HEADER_SCRIM = 0.26;      // how much the header's own dark fade dims the image behind the logo at the top of the page
  var TRANSITION_MS = 600;      // how long the colour takes to change from one slide's colour to the next
  var DESKTOP_QUERY = '(min-width: 920px)'; // keep in step with the header breakpoint in style.css
  var WHITE = '#ffffff';

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

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }

  function hsvToRgb(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function channelToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  // WCAG relative luminance (0 = black, 1 = white) of an sRGB colour.
  function luminance(r, g, b) {
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
  }

  // ── Animating from one colour to the next ───────────────────────
  // Colours are blended in OKLCH: lightness and chroma move in a straight
  // line and the hue takes the short way round the colour wheel, so a
  // blue -> orange change sweeps through vivid in-between colours
  // instead of dipping through muddy grey.
  function srgbToLinear(c) { return channelToLinear(c); }
  function linearToSrgb(c) {
    c = clamp(c, 0, 1);
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  }

  function rgbToOklch(rgb) {
    var r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [L, Math.sqrt(A * A + B * B), Math.atan2(B, A)];
  }

  function oklchToRgb(lch) {
    var A = lch[1] * Math.cos(lch[2]), B = lch[1] * Math.sin(lch[2]);
    var l = Math.pow(lch[0] + 0.3963377774 * A + 0.2158037573 * B, 3);
    var m = Math.pow(lch[0] - 0.1055613458 * A - 0.0638541728 * B, 3);
    var s = Math.pow(lch[0] - 0.0894841775 * A - 1.2914855480 * B, 3);
    return [
      linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    ];
  }

  function mixOklch(from, to, t) {
    var a = rgbToOklch(from), b = rgbToOklch(to);
    // A (near-)grey end has no real hue - borrow the other end's, so the
    // colour fades in/out instead of spinning round the wheel.
    if (a[1] < 0.02) a[2] = b[2];
    if (b[1] < 0.02) b[2] = a[2];
    var dh = b[2] - a[2];
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    return oklchToRgb([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + dh * t
    ]);
  }

  function parseColor(str) {
    var m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(str);
    if (m) return [+m[1], +m[2], +m[3]];
    var hex = /^#([0-9a-f]{6})$/i.exec(str);
    if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4), 16)];
    return [255, 255, 255];
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  var shown = [255, 255, 255]; // the colour currently on screen
  var tweenId = 0;

  function paint(rgb) {
    shown = rgb;
    root.style.setProperty('--logo-tint',
      'rgb(' + Math.round(rgb[0]) + ', ' + Math.round(rgb[1]) + ', ' + Math.round(rgb[2]) + ')');
  }

  function setLogoColor(target) {
    var to = parseColor(target);
    var id = ++tweenId;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { paint(to); return; }

    var from = shown.slice();
    var startTime = null;
    function frame(now) {
      if (id !== tweenId) return; // a newer colour took over (starts from wherever this one got to)
      if (startTime === null) startTime = now;
      var t = clamp((now - startTime) / TRANSITION_MS, 0, 1);
      paint(t >= 1 ? to : mixOklch(from, to, easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

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

  // ── How bright is the picture right behind the logo? ────────────
  // Where the logo sits inside the feature band, worked out from the
  // header's CSS sizes (not measured from the page), so it doesn't depend
  // on the header having loaded or on the scroll position.
  function logoRegionInBand() {
    var cs = getComputedStyle(root);
    var size = parseFloat(cs.getPropertyValue('--logo-size')) || 96;
    var headerH = parseFloat(cs.getPropertyValue('--header-h')) || 140;
    return { x: (band.clientWidth - size) / 2, y: (headerH - size) / 2, w: size, h: size };
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
  // Keep the picture's hue, but wash it out: high lightness, moderate
  // saturation. A grey picture has no hue to keep, so the logo stays
  // the standard white.
  function pickLogoColor(hsl) {
    if (!hsl) return WHITE;
    var s = clamp(hsl[1], WASH_SATURATION_MIN, WASH_SATURATION_MAX);
    var rgb = hslToRgb(hsl[0], s, WASH_LIGHTNESS);
    return 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')';
  }

  // Bright area behind the logo -> darker logo: a black overlay (up to
  // LIGHT_BG_DARKEN) plus some saturation added back (LIGHT_BG_SATURATION,
  // otherwise a pale colour just turns grey when it's darkened). Both ease
  // in from LIGHT_BG_START to full strength at LIGHT_BG_FULL. Greys and
  // white have no colour to add to, so they only get darker.
  function darkenForBrightBackground(color, bgLum) {
    var t = clamp((bgLum - LIGHT_BG_START) / (LIGHT_BG_FULL - LIGHT_BG_START), 0, 1);
    t = t * t * (3 - 2 * t);
    if (t <= 0) return color;
    var rgb = parseColor(color);
    var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    var sat = hsv[1] > 0.03 ? clamp(hsv[1] + LIGHT_BG_SATURATION * t, 0, 1) : hsv[1];
    var out = hsvToRgb(hsv[0], sat, hsv[2] * (1 - LIGHT_BG_DARKEN * t));
    return 'rgb(' + out[0] + ', ' + out[1] + ', ' + out[2] + ')';
  }

  function colorForSlide(img, slide) {
    var rect = visibleRect(img, slide);
    var color = pickLogoColor(dominantHsl(img, rect));
    var bgLum = backgroundLuminance(img, rect);
    return bgLum === null ? color : darkenForBrightBackground(color, bgLum);
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
  var desktop = window.matchMedia(DESKTOP_QUERY);

  // Every slide's logo colour is worked out up front: all the slide images
  // load in parallel and are analysed once, so a slide change can start
  // the colour change instantly instead of waiting on an image.
  var colorCache = new Map();   // slide element -> logo colour
  var buildPromise = null;
  function buildCache() {
    if (!buildPromise) {
      var slides = Array.prototype.slice.call(carousel.querySelectorAll('.feature-slide'));
      buildPromise = Promise.all(slides.map(function (slide) {
        var url = slideImageUrl(slide);
        return (url ? loadImage(url) : Promise.resolve(null)).then(function (img) {
          colorCache.set(slide, img ? colorForSlide(img, slide) : WHITE);
        });
      }));
    }
    return buildPromise;
  }

  function show(slide) {
    setLogoColor(colorCache.get(slide) || WHITE);
    updateAmount();
    waitForLogo();
  }

  var token = 0;
  function refresh() {
    if (!desktop.matches) return;
    var slide = carousel.querySelector('.feature-slide.is-active') ||
      carousel.querySelector('.feature-slide');
    if (!slide) return;
    if (colorCache.has(slide)) { show(slide); return; } // normal case: instant
    var mine = ++token;                                  // first moments: wait for the images
    buildCache().then(function () {
      if (mine === token && desktop.matches) show(slide);
    });
  }

  function updateAmount() {
    if (!desktop.matches) return;
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
    resizeTimer = setTimeout(function () {
      if (!desktop.matches) return;
      colorCache.clear();
      buildPromise = null;
      buildCache().then(function () { refresh(); updateAmount(); });
    }, 200);
  });

  // Crossing the desktop breakpoint: switch the effect fully off (plain
  // white logo again) or back on.
  function onBreakpoint() {
    if (desktop.matches) {
      refresh();
      updateAmount();
    } else {
      tweenId++;                                   // stop any animation in flight
      shown = [255, 255, 255];
      root.classList.remove('logo-tint-ready');
      root.style.removeProperty('--logo-tint');
      root.style.removeProperty('--logo-tint-amount');
    }
  }
  if (desktop.addEventListener) desktop.addEventListener('change', onBreakpoint);
  else desktop.addListener(onBreakpoint);

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