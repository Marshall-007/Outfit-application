/*!
 * Mirror — virtual try-on widget (POC)
 *
 * Integration (the whole thing):
 *   <script src="https://<mirror-server>/mirror.js" defer></script>
 *
 * Optional attributes on the script tag:
 *   data-mirror-api="https://<mirror-server>"   API base (defaults to the script's own origin)
 *   data-mirror-selector="..."                  CSS selector overriding product detection
 *
 * Explicit product markup (recommended for retailers):
 *   <img src="..." data-mirror-product="sku-123" data-mirror-name="Denim Jacket"
 *        data-mirror-mode="mirror|tryon">
 * Without markup, Mirror falls back to a simple heuristic that finds large
 * product-like images on the page.
 */
(function () {
  'use strict';
  if (window.Mirror) return; // don't double-install

  var VERSION = '0.1.0';

  // ---------------------------------------------------------------- config
  var script = document.currentScript || document.querySelector('script[src*="mirror.js"]');
  var scriptOrigin = null;
  try { scriptOrigin = script && script.src ? new URL(script.src, location.href).origin : null; } catch (e) {}
  var API_BASE = (script && script.getAttribute('data-mirror-api')) || scriptOrigin || location.origin;
  var CUSTOM_SELECTOR = script && script.getAttribute('data-mirror-selector');

  var LS_PHOTO = 'mirror.userPhoto';
  var LS_CLOSET = 'mirror.closet';

  // ---------------------------------------------------------------- state
  var state = {
    step: 'photo',            // photo | preview | generating | result | error
    tab: 'tryon',             // tryon | closet
    product: null,            // { id, name, mode, imageUrl, imageBase64 }
    result: null,             // { image, provider, demoFallback }
    suggestions: null,        // filled by the closet tab
    suggesting: false,
    error: null,
    serverInfo: null,         // /api/health payload
  };
  var registry = [];          // [{ img, btn, product }]
  var shadow = null, root = null, lastFocus = null;
  var genTimer = null, genAbort = null;

  function getPhoto() { try { return localStorage.getItem(LS_PHOTO); } catch (e) { return null; } }
  function setPhoto(dataUrl) { try { localStorage.setItem(LS_PHOTO, dataUrl); } catch (e) {} }
  function getCloset() {
    try { return JSON.parse(localStorage.getItem(LS_CLOSET) || '[]'); } catch (e) { return []; }
  }
  function setCloset(items) { try { localStorage.setItem(LS_CLOSET, JSON.stringify(items)); } catch (e) {} }

  // ------------------------------------------------------- product detection
  function absoluteUrl(src) {
    try { return new URL(src, location.href).href; } catch (e) { return null; }
  }

  function productFromElement(el) {
    var img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (!img) return null;
    var src = img.currentSrc || img.src || '';
    var product = {
      id: el.getAttribute('data-mirror-product') || null,
      name: el.getAttribute('data-mirror-name') || img.alt || document.title,
      mode: el.getAttribute('data-mirror-mode') === 'mirror' ? 'mirror' : 'tryon',
    };
    if (src.indexOf('data:') === 0) product.imageBase64 = src;
    else product.imageUrl = absoluteUrl(src);
    if (!product.imageUrl && !product.imageBase64) return null;
    return { img: img, product: product };
  }

  function guessName(img) {
    if (img.alt && img.alt.length > 2) return img.alt;
    var node = img;
    for (var depth = 0; depth < 4 && node; depth++) {
      var heading = node.querySelector && node.querySelector('h1,h2,h3,h4');
      if (heading && heading.textContent.trim()) return heading.textContent.trim().slice(0, 80);
      node = node.parentElement;
    }
    return document.title || 'this piece';
  }

  function heuristicProducts() {
    var found = [];
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var rect = img.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 250) continue;
      var ratio = rect.width / rect.height;
      if (ratio < 0.5 || ratio > 2) continue;
      var src = img.currentSrc || img.src || '';
      if (!src || src.indexOf('data:') === 0) continue;
      if (img.closest('header, footer, nav')) continue;
      if (img.closest('[data-mirror-ui]')) continue;
      found.push({ img: img, area: rect.width * rect.height });
    }
    found.sort(function (a, b) { return b.area - a.area; });
    return found.slice(0, 12).map(function (entry) {
      return {
        img: entry.img,
        product: {
          id: null,
          name: guessName(entry.img),
          mode: 'tryon',
          imageUrl: absoluteUrl(entry.img.currentSrc || entry.img.src),
        },
      };
    });
  }

  function detectProducts() {
    var targets = [];
    var selector = CUSTOM_SELECTOR || '[data-mirror-product]';
    var explicit = document.querySelectorAll(selector);
    for (var i = 0; i < explicit.length; i++) {
      var entry = productFromElement(explicit[i]);
      if (entry) targets.push(entry);
    }
    if (targets.length === 0) targets = heuristicProducts();
    return targets;
  }

  // --------------------------------------------------------- button overlay
  function makeButton(mode) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-mirror-ui', '');
    btn.className = 'mirror-tryon-btn';
    btn.textContent = mode === 'mirror' ? 'See it on you 🪞' : 'Try it on ✨';
    btn.style.cssText = [
      'position:absolute', 'z-index:2147482000', 'padding:8px 14px',
      'border:none', 'border-radius:999px', 'cursor:pointer',
      'background:rgba(20,18,24,0.92)', 'color:#fff',
      'font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'letter-spacing:0.2px', 'box-shadow:0 2px 10px rgba(0,0,0,0.28)',
      'transition:transform .15s ease, background .15s ease',
    ].join(';');
    btn.onmouseenter = function () { btn.style.transform = 'scale(1.05)'; btn.style.background = '#000'; };
    btn.onmouseleave = function () { btn.style.transform = 'scale(1)'; btn.style.background = 'rgba(20,18,24,0.92)'; };
    return btn;
  }

  function positionButton(entry) {
    var rect = entry.img.getBoundingClientRect();
    var visible = rect.width > 40 && rect.height > 40 && entry.img.offsetParent !== null;
    entry.btn.style.display = visible ? '' : 'none';
    if (!visible) return;
    var x = rect.right + window.scrollX - entry.btn.offsetWidth - 12;
    var y = rect.bottom + window.scrollY - entry.btn.offsetHeight - 12;
    entry.btn.style.left = x + 'px';
    entry.btn.style.top = y + 'px';
  }

  function repositionAll() {
    for (var i = 0; i < registry.length; i++) positionButton(registry[i]);
  }

  var rafPending = false;
  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; repositionAll(); });
  }

  function injectButtons() {
    var targets = detectProducts();
    targets.forEach(function (target) {
      var already = registry.some(function (r) { return r.img === target.img; });
      if (already) return;
      var btn = makeButton(target.product.mode);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openModal(target.product);
      });
      document.body.appendChild(btn);
      var entry = { img: target.img, btn: btn, product: target.product };
      registry.push(entry);
      positionButton(entry);
      target.img.addEventListener('load', scheduleReposition);
    });
  }

  // -------------------------------------------------------------- image utils
  function fileToDataUrl(file, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not a readable image.')); };
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality || 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------- API client
  function apiFetch(path, body, timeoutMs) {
    genAbort = new AbortController();
    var timer = setTimeout(function () { genAbort.abort(); }, timeoutMs || 60000);
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: genAbort.signal,
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || ('Request failed (' + res.status + ')');
          var err = new Error(msg);
          err.code = data && data.error && data.error.code;
          throw err;
        }
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('This is taking longer than expected. Please try again.');
      throw err;
    });
  }

  // ---------------------------------------------------------------- modal
  var STATUS_LINES = [
    'Reading the garment…',
    'Fitting the fabric…',
    'Matching the lighting…',
    'Tailoring the details…',
    'Almost there — final stitches…',
  ];

  function ensureModal() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'mirror-root';
    root.setAttribute('data-mirror-ui', '');
    document.body.appendChild(root);
    shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = baseTemplate();
    shadow.getElementById('overlay').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Tab') trapFocus(e);
    });
    fetch(API_BASE + '/api/health').then(function (r) { return r.json(); })
      .then(function (info) { state.serverInfo = info; })
      .catch(function () {});
  }

  function baseTemplate() {
    return '<style>' + css() + '</style>' +
      '<div class="overlay" id="overlay" hidden>' +
      '  <div class="dialog" role="dialog" aria-modal="true" aria-label="Mirror virtual try-on">' +
      '    <div class="head">' +
      '      <div class="brand">Mirror <span class="spark">✨</span></div>' +
      '      <div class="tabs">' +
      '        <button class="tab" data-tab="tryon" type="button">Try on</button>' +
      '        <button class="tab" data-tab="closet" type="button">My closet</button>' +
      '      </div>' +
      '      <button class="close" id="close" type="button" aria-label="Close">×</button>' +
      '    </div>' +
      '    <div class="body" id="body"></div>' +
      '    <div class="foot">Your photo is processed transiently to create the preview and is never stored on our servers.</div>' +
      '  </div>' +
      '</div>' +
      '<div class="toast" id="toast" hidden></div>';
  }

  function css() {
    return [
      ':host { all: initial; }',
      '* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
      '.overlay { position: fixed; inset: 0; background: rgba(15,13,18,0.55); backdrop-filter: blur(3px); z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 18px; }',
      '.dialog { width: 520px; max-width: 100%; max-height: 92vh; background: #fff; border-radius: 16px; box-shadow: 0 24px 80px rgba(0,0,0,0.35); display: flex; flex-direction: column; overflow: hidden; }',
      '.head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-bottom: 1px solid #eee7f0; }',
      '.brand { font-weight: 700; font-size: 17px; color: #17141c; letter-spacing: 0.2px; }',
      '.spark { font-size: 14px; }',
      '.tabs { display: flex; gap: 4px; flex: 1; }',
      '.tab { border: none; background: none; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #6d6478; cursor: pointer; }',
      '.tab.active { background: #f1ebf7; color: #4b2d73; }',
      '.close { border: none; background: none; font-size: 26px; line-height: 1; color: #a99fb3; cursor: pointer; padding: 2px 6px; border-radius: 8px; }',
      '.close:hover { background: #f4eff8; color: #4b2d73; }',
      '.body { padding: 20px 22px; overflow-y: auto; }',
      '.foot { padding: 10px 22px 14px; font-size: 11px; color: #a49aae; border-top: 1px solid #f2edf6; }',
      '.step-title { font-size: 19px; font-weight: 700; color: #17141c; margin-bottom: 4px; }',
      '.step-sub { font-size: 13px; color: #766c81; margin-bottom: 16px; }',
      '.upload-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 2px dashed #d8cbe6; border-radius: 14px; padding: 42px 20px; cursor: pointer; text-align: center; color: #6d6478; font-size: 14px; transition: border-color .15s ease, background .15s ease; }',
      '.upload-tile:hover { border-color: #8a5fc9; background: #faf7fd; }',
      '.upload-tile .big { font-size: 34px; }',
      '.photo-row { display: flex; gap: 14px; align-items: flex-start; }',
      '.photo-thumb { width: 130px; border-radius: 12px; display: block; }',
      '.side-by-side { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }',
      '.side-by-side figure { position: relative; }',
      '.side-by-side img { width: 100%; aspect-ratio: 4/5; object-fit: cover; border-radius: 12px; background: #f3eff7; display: block; }',
      '.side-by-side figcaption { position: absolute; left: 8px; bottom: 8px; background: rgba(20,18,24,0.75); color: #fff; font-size: 11px; padding: 3px 9px; border-radius: 999px; }',
      '.plus { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 34px; height: 34px; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.18); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #8a5fc9; font-weight: 700; }',
      '.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; border: none; border-radius: 12px; padding: 14px 18px; font-size: 15px; font-weight: 700; cursor: pointer; background: linear-gradient(135deg, #6b3fa0, #a84a8f); color: #fff; transition: filter .15s ease; }',
      '.btn:hover { filter: brightness(1.1); }',
      '.btn.secondary { background: #f1ebf7; color: #4b2d73; }',
      '.btn:disabled { opacity: 0.55; cursor: default; }',
      '.btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }',
      '.link { background: none; border: none; color: #8a5fc9; font-size: 13px; cursor: pointer; text-decoration: underline; padding: 0; margin-top: 12px; }',
      '.gen { text-align: center; padding: 34px 10px; }',
      '.spinner { width: 52px; height: 52px; border-radius: 50%; border: 4px solid #eee2f6; border-top-color: #8a5fc9; margin: 0 auto 20px; animation: spin 0.9s linear infinite; }',
      '@keyframes spin { to { transform: rotate(360deg); } }',
      '.gen-line { font-size: 14px; color: #6d6478; min-height: 20px; }',
      '.cmp { position: relative; border-radius: 14px; overflow: hidden; aspect-ratio: 4/5; background: #f3eff7; user-select: none; }',
      '.cmp img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.cmp .after-wrap { position: absolute; inset: 0; }',
      '.cmp .divider { position: absolute; top: 0; bottom: 0; width: 3px; background: #fff; box-shadow: 0 0 8px rgba(0,0,0,0.35); pointer-events: none; }',
      '.cmp .knob { position: absolute; top: 50%; width: 34px; height: 34px; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.3); transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; font-size: 13px; color: #4b2d73; pointer-events: none; }',
      '.cmp input[type=range] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; }',
      '.cmp .taglabel { position: absolute; top: 10px; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: rgba(20,18,24,0.72); color: #fff; pointer-events: none; }',
      '.cmp .tag-before { left: 10px; }',
      '.cmp .tag-after { right: 10px; }',
      '.badge { position: absolute; bottom: 10px; right: 10px; background: #fff3d6; color: #8a6414; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; pointer-events: none; }',
      '.result-actions { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 14px; }',
      '.err { text-align: center; padding: 26px 8px; }',
      '.err .icon { font-size: 34px; margin-bottom: 10px; }',
      '.err p { font-size: 14px; color: #6d6478; margin-bottom: 18px; }',
      '.closet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }',
      '.closet-item { position: relative; }',
      '.closet-item img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; background: #f3eff7; display: block; }',
      '.closet-item input { width: 100%; border: none; font-size: 11px; color: #6d6478; margin-top: 4px; text-align: center; background: none; }',
      '.closet-item .del { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border-radius: 50%; border: none; background: rgba(20,18,24,0.7); color: #fff; font-size: 13px; cursor: pointer; display: none; align-items: center; justify-content: center; }',
      '.closet-item:hover .del { display: flex; }',
      '.closet-add { aspect-ratio: 1; border: 2px dashed #d8cbe6; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; color: #8a5fc9; font-size: 12px; font-weight: 600; }',
      '.closet-add:hover { background: #faf7fd; }',
      '.closet-add .big { font-size: 22px; }',
      '.sugg-card { border: 1px solid #eee2f4; border-radius: 12px; padding: 14px; margin-bottom: 12px; }',
      '.sugg-card h4 { font-size: 14px; color: #17141c; margin-bottom: 6px; }',
      '.sugg-thumbs { display: flex; gap: 6px; margin-bottom: 8px; }',
      '.sugg-thumbs img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: #f3eff7; }',
      '.sugg-card p { font-size: 13px; color: #6d6478; line-height: 1.45; }',
      '.missing { margin-top: 8px; font-size: 12px; color: #8a6414; background: #fff7e0; border-radius: 8px; padding: 6px 10px; display: inline-block; }',
      '.empty { text-align: center; color: #766c81; font-size: 13px; padding: 26px 12px; }',
      '.empty .big { font-size: 30px; display: block; margin-bottom: 8px; }',
      '@media (max-width: 560px) { .dialog { width: 100%; max-height: 96vh; } .side-by-side { grid-template-columns: 1fr; } }',
    ].join('\n');
  }

  function openModal(product) {
    ensureModal();
    if (product) {
      state.product = product;
      state.tab = 'tryon';
      state.result = null;
      state.error = null;
      state.step = getPhoto() ? 'preview' : 'photo';
    }
    lastFocus = document.activeElement;
    shadow.getElementById('overlay').hidden = false;
    render();
    var closeBtn = shadow.getElementById('close');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (!shadow) return;
    if (genAbort) { try { genAbort.abort(); } catch (e) {} genAbort = null; }
    stopStatusLines();
    shadow.getElementById('overlay').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function trapFocus(e) {
    var focusables = shadow.querySelectorAll('button, input, [tabindex]');
    var list = Array.prototype.filter.call(focusables, function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    var active = shadow.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  // --------------------------------------------------------------- rendering
  function render() {
    var body = shadow.getElementById('body');
    var tabs = shadow.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === state.tab);
      tabs[i].onclick = onTabClick;
    }
    shadow.getElementById('close').onclick = closeModal;
    if (state.tab === 'closet') { body.innerHTML = closetView(); bindCloset(body); }
    else { body.innerHTML = tryonView(); bindTryon(body); }
  }

  function onTabClick() {
    state.tab = this.getAttribute('data-tab');
    render();
  }

  function productImgSrc() {
    var p = state.product || {};
    return p.imageBase64 || p.imageUrl || '';
  }

  function tryonView() {
    var p = state.product;
    if (!p) return '<div class="empty"><span class="big">👗</span>Pick a product on the page (look for the “Try it on ✨” button) to get started.</div>';
    switch (state.step) {
      case 'photo': return photoView();
      case 'preview': return previewView();
      case 'generating': return generatingView();
      case 'result': return resultView();
      case 'error': return errorView();
    }
    return '';
  }

  function photoView() {
    var stored = getPhoto();
    var intro = '<div class="step-title">First, add a photo of you</div>' +
      '<div class="step-sub">Use a well-lit, front-facing photo. You only do this once — it’s saved in your browser for next time.</div>';
    if (stored) {
      return intro +
        '<div class="photo-row">' +
        '  <img class="photo-thumb" src="' + stored + '" alt="Your saved photo">' +
        '  <div style="flex:1">' +
        '    <button class="btn" id="use-photo" type="button">Use this photo</button>' +
        '    <button class="link" id="change-photo" type="button">Choose a different photo</button>' +
        '  </div>' +
        '</div>' +
        '<input type="file" id="file" accept="image/*" capture="user" hidden>';
    }
    return intro +
      '<div class="upload-tile" id="upload-tile" tabindex="0" role="button" aria-label="Add your photo">' +
      '  <span class="big">📸</span>' +
      '  <strong>Add your photo</strong>' +
      '  <span>Tap to choose a photo or take one with your camera</span>' +
      '</div>' +
      '<input type="file" id="file" accept="image/*" capture="user" hidden>';
  }

  function previewView() {
    var p = state.product;
    var verb = p.mode === 'mirror' ? 'See yourself as the model' : 'Ready to try it on?';
    return '<div class="step-title">' + verb + '</div>' +
      '<div class="step-sub">' + escapeHtml(p.name || 'This piece') + '</div>' +
      '<div class="side-by-side">' +
      '  <figure><img src="' + getPhoto() + '" alt="Your photo"><figcaption>You</figcaption></figure>' +
      '  <figure><img src="' + productImgSrc() + '" alt="Product"><figcaption>' + (p.mode === 'mirror' ? 'The model shot' : 'The piece') + '</figcaption><div class="plus">+</div></figure>' +
      '</div>' +
      '<button class="btn" id="generate" type="button">' + (p.mode === 'mirror' ? 'Put me in this photo 🪞' : 'Generate my look ✨') + '</button>' +
      '<button class="link" id="change-photo" type="button">Change my photo</button>';
  }

  function generatingView() {
    return '<div class="gen">' +
      '  <div class="spinner"></div>' +
      '  <div class="step-title">Creating your look</div>' +
      '  <div class="gen-line" id="gen-line">' + STATUS_LINES[0] + '</div>' +
      '</div>';
  }

  function resultView() {
    var r = state.result;
    var isSample = r && (r.provider !== 'gemini' || r.demoFallback);
    var before = state.product.mode === 'mirror' ? productImgSrc() : getPhoto();
    return '<div class="step-title">Here’s your look</div>' +
      '<div class="step-sub">' + escapeHtml(state.product.name || '') + ' — drag the slider to compare</div>' +
      '<div class="cmp" id="cmp">' +
      '  <img src="' + before + '" alt="Before">' +
      '  <div class="after-wrap" id="after-wrap"><img src="' + r.image + '" alt="You wearing it"></div>' +
      '  <div class="divider" id="divider"></div>' +
      '  <div class="knob" id="knob">↔</div>' +
      '  <span class="taglabel tag-before">Before</span>' +
      '  <span class="taglabel tag-after">Your look</span>' +
      (isSample ? '<span class="badge">Sample result</span>' : '') +
      '  <input type="range" id="cmp-range" min="0" max="100" value="50" aria-label="Compare before and after">' +
      '</div>' +
      '<div class="result-actions">' +
      '  <button class="btn secondary" id="download" type="button">Download ⬇</button>' +
      '  <button class="btn secondary" id="again" type="button">Try again ↻</button>' +
      '  <button class="btn" id="bag" type="button">Add to bag 🛍</button>' +
      '  <button class="btn secondary" id="outfit" type="button">Complete the outfit →</button>' +
      '</div>';
  }

  function errorView() {
    return '<div class="err">' +
      '  <div class="icon">🪡</div>' +
      '  <div class="step-title">That didn’t work</div>' +
      '  <p>' + escapeHtml(state.error || 'Something went wrong.') + '</p>' +
      '  <button class="btn" id="retry" type="button">Try again</button>' +
      '</div>';
  }

  // -------------------------------------------------------------- behaviors
  function bindTryon(body) {
    var file = body.querySelector('#file');
    if (file) {
      file.addEventListener('change', function () {
        if (!file.files || !file.files[0]) return;
        fileToDataUrl(file.files[0], 1024, 0.85).then(function (dataUrl) {
          setPhoto(dataUrl);
          state.step = 'preview';
          render();
        }).catch(function (err) {
          state.error = err.message;
          state.step = 'error';
          render();
        });
      });
    }
    var tile = body.querySelector('#upload-tile');
    if (tile) {
      tile.addEventListener('click', function () { file.click(); });
      tile.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') file.click(); });
    }
    var usePhoto = body.querySelector('#use-photo');
    if (usePhoto) usePhoto.addEventListener('click', function () { state.step = 'preview'; render(); });
    var changePhoto = body.querySelector('#change-photo');
    if (changePhoto) changePhoto.addEventListener('click', function () {
      // jump to the bare upload tile
      try { localStorage.removeItem(LS_PHOTO); } catch (e) {}
      state.step = 'photo';
      render();
    });
    var generate = body.querySelector('#generate');
    if (generate) generate.addEventListener('click', function () { runTryon([]); });
    var retry = body.querySelector('#retry');
    if (retry) retry.addEventListener('click', function () {
      state.step = getPhoto() ? 'preview' : 'photo';
      render();
    });
    bindResult(body);
  }

  function bindResult(body) {
    var range = body.querySelector('#cmp-range');
    if (range) {
      var afterWrap = body.querySelector('#after-wrap');
      var divider = body.querySelector('#divider');
      var knob = body.querySelector('#knob');
      var update = function () {
        var pct = Number(range.value);
        afterWrap.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
        divider.style.left = pct + '%';
        knob.style.left = pct + '%';
      };
      range.addEventListener('input', update);
      update();
    }
    var download = body.querySelector('#download');
    if (download) download.addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = state.result.image;
      a.download = 'mirror-look.jpg';
      a.click();
    });
    var again = body.querySelector('#again');
    if (again) again.addEventListener('click', function () { runTryon([]); });
    var bag = body.querySelector('#bag');
    if (bag) bag.addEventListener('click', function () { toast('Added to bag — (demo, nothing was bought!)'); });
    var outfit = body.querySelector('#outfit');
    if (outfit) outfit.addEventListener('click', function () { state.tab = 'closet'; render(); });
  }

  var statusTimer = null;
  function startStatusLines() {
    var i = 0;
    statusTimer = setInterval(function () {
      i = (i + 1) % STATUS_LINES.length;
      var el = shadow.getElementById('gen-line');
      if (el) el.textContent = STATUS_LINES[i];
    }, 2400);
  }
  function stopStatusLines() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  }

  function runTryon(extraGarments) {
    var p = state.product;
    state.step = 'generating';
    render();
    startStatusLines();
    var payload = {
      mode: p.mode,
      userPhoto: getPhoto(),
      product: { id: p.id || undefined, name: p.name || undefined, imageUrl: p.imageUrl || undefined, imageBase64: p.imageBase64 || undefined },
      extraGarments: extraGarments || [],
    };
    apiFetch('/api/tryon', payload, 60000).then(function (data) {
      stopStatusLines();
      state.result = data;
      state.step = 'result';
      render();
    }).catch(function (err) {
      stopStatusLines();
      state.error = err.message;
      state.step = 'error';
      render();
    });
  }

  // ------------------------------------------------------------------ closet
  function closetView() {
    var items = getCloset();
    var cells = items.map(function (item, i) {
      return '<div class="closet-item" data-i="' + i + '">' +
        '<img src="' + item.dataURL + '" alt="' + escapeHtml(item.label) + '">' +
        '<button class="del" type="button" aria-label="Remove">×</button>' +
        '<input value="' + escapeHtml(item.label) + '" aria-label="Item label">' +
        '</div>';
    }).join('');
    var addTile = items.length < 8
      ? '<div class="closet-add" id="closet-add" tabindex="0" role="button"><span class="big">＋</span>Add item</div>'
      : '';
    var suggestBlock = '';
    if (items.length === 0) {
      return '<div class="step-title">My closet</div>' +
        '<div class="step-sub">Add photos of clothes you already own and Mirror will build outfits around what you’re browsing.</div>' +
        '<div class="closet-grid">' + addTile + '</div>' +
        '<input type="file" id="closet-file" accept="image/*" hidden>';
    }
    if (state.suggesting) {
      suggestBlock = '<div class="gen"><div class="spinner"></div><div class="gen-line">Styling outfits from your closet…</div></div>';
    } else if (state.suggestions && state.suggestions.length) {
      suggestBlock = state.suggestions.map(function (s) {
        var thumbs = (s.closetItemIds || []).map(function (id) {
          var item = items.filter(function (c) { return c.id === id; })[0];
          return item ? '<img src="' + item.dataURL + '" alt="' + escapeHtml(item.label) + '" title="' + escapeHtml(item.label) + '">' : '';
        }).join('');
        return '<div class="sugg-card">' +
          '<h4>' + escapeHtml(s.title) + '</h4>' +
          '<div class="sugg-thumbs">' + thumbs + '</div>' +
          '<p>' + escapeHtml(s.reasoning) + '</p>' +
          (s.missingPiece ? '<span class="missing">Missing piece: ' + escapeHtml(s.missingPiece) + '</span>' : '') +
          '</div>';
      }).join('');
    } else {
      var canSuggest = !!state.product;
      suggestBlock = canSuggest
        ? '<button class="btn" id="suggest" type="button">Suggest outfits with ' + escapeHtml(shortName(state.product.name)) + ' ✨</button>'
        : '<div class="empty">Open a product page to get outfit suggestions that pair with your closet.</div>';
    }
    return '<div class="step-title">My closet</div>' +
      '<div class="step-sub">' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' · stored only in your browser</div>' +
      '<div class="closet-grid">' + cells + addTile + '</div>' +
      suggestBlock +
      '<input type="file" id="closet-file" accept="image/*" hidden>';
  }

  function shortName(name) {
    if (!name) return 'this piece';
    return name.length > 28 ? name.slice(0, 26) + '…' : name;
  }

  function bindCloset(body) {
    var file = body.querySelector('#closet-file');
    var add = body.querySelector('#closet-add');
    if (add) {
      add.addEventListener('click', function () { file.click(); });
      add.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') file.click(); });
    }
    if (file) {
      file.addEventListener('change', function () {
        if (!file.files || !file.files[0]) return;
        fileToDataUrl(file.files[0], 512, 0.8).then(function (dataUrl) {
          var items = getCloset();
          items.push({ id: 'c-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), label: 'my item', dataURL: dataUrl, addedAt: Date.now() });
          setCloset(items);
          state.suggestions = null;
          render();
        }).catch(function (err) { toast(err.message); });
      });
    }
    var dels = body.querySelectorAll('.closet-item .del');
    for (var i = 0; i < dels.length; i++) {
      dels[i].addEventListener('click', function (e) {
        var idx = Number(e.target.closest('.closet-item').getAttribute('data-i'));
        var items = getCloset();
        items.splice(idx, 1);
        setCloset(items);
        state.suggestions = null;
        render();
      });
    }
    var labels = body.querySelectorAll('.closet-item input');
    for (var j = 0; j < labels.length; j++) {
      labels[j].addEventListener('change', function (e) {
        var idx = Number(e.target.closest('.closet-item').getAttribute('data-i'));
        var items = getCloset();
        if (items[idx]) { items[idx].label = e.target.value.slice(0, 40); setCloset(items); }
      });
    }
    var suggest = body.querySelector('#suggest');
    if (suggest) suggest.addEventListener('click', runSuggest);
  }

  function runSuggest() {
    var p = state.product;
    var items = getCloset();
    state.suggesting = true;
    render();
    apiFetch('/api/suggest', {
      product: { id: p.id || undefined, name: p.name || undefined, imageUrl: p.imageUrl || undefined, imageBase64: p.imageBase64 || undefined },
      closet: items.map(function (c) { return { id: c.id, label: c.label, imageBase64: c.dataURL }; }),
    }, 45000).then(function (data) {
      state.suggesting = false;
      state.suggestions = data.suggestions || [];
      render();
    }).catch(function (err) {
      state.suggesting = false;
      state.suggestions = null;
      toast(err.message);
      render();
    });
  }

  // ------------------------------------------------------------------- misc
  function toast(message) {
    ensureModal();
    var el = shadow.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#17141c;color:#fff;padding:11px 20px;border-radius:999px;font:600 13px -apple-system,sans-serif;z-index:2147483001;box-shadow:0 6px 24px rgba(0,0,0,0.3);';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    injectButtons();
    // late/lazy images shift layout — re-scan and reposition a few times
    setTimeout(function () { injectButtons(); repositionAll(); }, 800);
    setTimeout(function () { injectButtons(); repositionAll(); }, 2500);
    window.addEventListener('resize', scheduleReposition);
    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.addEventListener('load', function () { injectButtons(); repositionAll(); });
  }

  window.Mirror = {
    version: VERSION,
    open: function (product) { openModal(product || state.product || null); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
