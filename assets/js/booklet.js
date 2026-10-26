/* A Little Yarn, A Lot of Love: flip-through booklet.
 *
 * Pages are plain <article class="page"> elements inside #book. On start-up they
 * are moved into "leaves" (a sheet of paper with a front and a back face) that
 * rotate around the spine. Wide screens show two pages side by side like an
 * open booklet; narrow screens show one page at a time.
 */
(() => {
  'use strict';

  // Fake barcode (EAN-13). Change these 12 digits to use your own; the 13th
  // (check) digit is calculated automatically.
  const BARCODE_DIGITS = '622069020261';

  const RATIO = 3 / 4;        // page width / page height
  const MAX_PAGE_W = 560;     // px, so pages don't get huge on big monitors
  const FLIP_MS = 1100;       // one full page turn
  const QUICK_FLIP_MS = 520;  // used when jumping several pages at once

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage');
  const book = $('#book');
  const castLeft = book.querySelector('.cast--left');
  const castRight = book.querySelector('.cast--right');
  const pages = Array.from(book.querySelectorAll('.page'));
  const prevBtn = $('#prevBtn');
  const nextBtn = $('#nextBtn');
  const dotsEl = $('#dots');
  const counter = $('#counter');
  const toast = $('#toast');

  let mode = null;       // 'spread' | 'single'
  let leaves = [];       // { el, front, back, angle }
  let flipped = 0;       // how many leaves have been turned to the left
  let pw = 0;            // page width in px
  let busy = false;
  let queue = [];
  let drag = null;
  let activeLeaf = null; // the leaf currently turning
  let opened = false;    // has the reader turned a page yet?

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  /* ---------------------------------------------------------------- layout */

  const maxFlipped = () => (mode === 'spread' ? leaves.length : leaves.length - 1);

  // Where a turned leaf rests. On a phone there is no left page to land on, so
  // the page keeps going round the spine and folds away behind the book.
  const turnedAngle = () => (mode === 'single' ? -360 : -180);

  function visiblePages(f = flipped) {
    if (mode === 'single') return [f];
    return [2 * f - 1, 2 * f].filter((i) => i >= 0 && i < pages.length);
  }

  function stateForPage(index) {
    return mode === 'spread' ? Math.floor((index + 1) / 2) : index;
  }

  function makeFace(side, page) {
    const face = document.createElement('div');
    face.className = `face face--${side}`;
    if (page) face.appendChild(page);
    else face.classList.add('face--blank');
    const shade = document.createElement('div');
    shade.className = 'face__shade';
    face.appendChild(shade);
    return face;
  }

  function build(nextMode) {
    const anchor = mode ? visiblePages()[0] : 0;
    pages.forEach((p) => p.remove());
    leaves.forEach((l) => l.el.remove());

    mode = nextMode;
    book.dataset.mode = mode;
    const groups = [];
    if (mode === 'spread') {
      for (let i = 0; i < pages.length; i += 2) groups.push([pages[i], pages[i + 1] || null]);
    } else {
      pages.forEach((p) => groups.push([p, null]));
    }

    leaves = groups.map(([front, back]) => {
      const el = document.createElement('div');
      el.className = 'leaf';
      const f = makeFace('front', front);
      const b = makeFace('back', back);
      el.append(f, b);
      book.appendChild(el);
      return { el, front: f, back: b, angle: 0 };
    });

    flipped = clamp(stateForPage(anchor), 0, maxFlipped());
    leaves.forEach((l, i) => setAngle(l, i < flipped ? turnedAngle() : 0));
    restack();
    renderDots();
    updateUI(flipped, false);
    markVisible(flipped);
  }

  function layout() {
    const cs = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

    const spreadW = Math.min(w / 2, h * RATIO, MAX_PAGE_W);
    const singleW = Math.min(w, h * RATIO, MAX_PAGE_W);
    const nextMode = spreadW >= singleW * 0.75 && spreadW >= 150 ? 'spread' : 'single';

    pw = Math.max(120, Math.floor(nextMode === 'spread' ? spreadW : singleW));
    document.documentElement.style.setProperty('--pw', `${pw}px`);
    book.style.width = `${nextMode === 'spread' ? pw * 2 : pw}px`;
    book.style.height = `${Math.round(pw / RATIO)}px`;
    book.style.perspective = `${Math.round(pw * 4.5)}px`;

    if (nextMode !== mode) build(nextMode);
    shiftBook(flipped, 0);
  }

  // Closed booklet: slide it so the cover (or back cover) sits in the middle.
  function shiftBook(f, ms) {
    let shift = 0;
    let state = 'open';
    if (mode === 'spread') {
      if (f === 0) { shift = -pw / 2; state = 'start'; }
      else if (f === leaves.length) { shift = pw / 2; state = 'end'; }
    }
    book.style.setProperty('--shift-ms', `${ms}ms`);
    book.style.transform = `translateX(${shift}px)`;
    book.dataset.state = state;
  }

  /* ---------------------------------------------------------------- drawing */

  // Past 180° a page is behind the book, so it has to drop below the others.
  const activeZ = (leaf) => (leaf.angle < -180 ? 0 : leaves.length + 2);

  function setAngle(leaf, angle) {
    leaf.angle = angle;
    leaf.el.style.transform = `rotateY(${angle}deg)`;
    if (leaf === activeLeaf) leaf.el.style.zIndex = String(activeZ(leaf));
    let deg = Math.abs(angle) % 360;
    if (deg > 180) deg = 360 - deg; // the far half of a full turn mirrors the near half
    const t = deg / 180;
    const lift = Math.sin(t * Math.PI);
    leaf.front.style.setProperty('--shade', t < 0.5 ? (lift * 0.5).toFixed(3) : '0');
    leaf.back.style.setProperty('--shade', t >= 0.5 ? (lift * 0.5).toFixed(3) : '0');
  }

  // Shadow the turning page throws onto the pages underneath it.
  function castShadow(leaf) {
    if (!leaf || leaf.angle < -180) {
      castLeft.style.opacity = castRight.style.opacity = '0';
      return;
    }
    const t = Math.abs(leaf.angle) / 180;
    castRight.style.opacity = t < 0.5 ? (Math.sin(t * 2 * Math.PI) * 0.75).toFixed(3) : '0';
    castLeft.style.opacity = t > 0.5 ? (Math.sin((1 - t) * 2 * Math.PI) * 0.75).toFixed(3) : '0';
  }

  function restack(active = null) {
    const n = leaves.length;
    activeLeaf = active;
    castLeft.style.zIndex = castRight.style.zIndex = String(n + 1);
    leaves.forEach((l, i) => {
      l.el.style.zIndex = String(l === active ? activeZ(l) : i < flipped ? i + 1 : n - i);
      let show;
      if (l === active) show = true;
      else if (mode === 'single') show = i >= flipped && i <= flipped + 1;
      else show = i >= flipped - 2 && i <= flipped + 1;
      l.el.style.visibility = show ? 'visible' : 'hidden';
    });
  }

  /* ---------------------------------------------------------------- turning */

  function animate(leaf, to, ms, commitDir) {
    busy = true;
    restack(leaf);
    const target = flipped + commitDir;
    if (commitDir) {
      updateUI(target, true);
      markVisible(target, true);
      shiftBook(target, ms);
    }
    const from = leaf.angle;
    const sweep = Math.abs(to - from);
    const fullCircle = sweep > 180; // phones only
    const duration = reduceMotion.matches ? 0 : Math.max(180, (ms * sweep) / (fullCircle ? 360 : 180));
    // A full circle is slow while the page is on screen (near 0°) and quick once it's out of sight.
    const ease = !fullCircle ? easeInOut : to < from ? easeIn : easeOut;
    const start = performance.now();

    const step = (now) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      setAngle(leaf, from + (to - from) * ease(t));
      castShadow(leaf);
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      flipped = target;
      busy = false;
      castShadow(null);
      restack();
      markVisible(flipped);
      const next = queue.shift();
      if (next) turn(next.dir, next.ms);
    };
    requestAnimationFrame(step);
  }

  function turn(dir, ms = FLIP_MS) {
    if (busy) {
      if (queue.length < 4) queue.push({ dir, ms });
      return;
    }
    if (dir > 0 ? flipped >= maxFlipped() : flipped <= 0) {
      bump(dir);
      return;
    }
    hideHint();
    const leaf = dir > 0 ? leaves[flipped] : leaves[flipped - 1];
    animate(leaf, dir > 0 ? turnedAngle() : 0, ms, dir);
  }

  function goToPage(index) {
    const target = clamp(stateForPage(index), 0, maxFlipped());
    if (busy || target === flipped) return;
    const dir = Math.sign(target - flipped);
    const steps = Math.abs(target - flipped);
    const ms = steps > 1 ? QUICK_FLIP_MS : FLIP_MS;
    queue = Array.from({ length: steps - 1 }, () => ({ dir, ms }));
    turn(dir, ms);
  }

  // Little "nope" wiggle at either end of the booklet.
  function bump(dir) {
    if (reduceMotion.matches || !book.animate) return;
    book.animate(
      [{ translate: '0 0' }, { translate: `${dir * -10}px 0` }, { translate: '0 0' }],
      { duration: 320, easing: 'ease-out', composite: 'add' }
    );
  }

  /* ---------------------------------------------------------------- UI state */

  function renderDots() {
    dotsEl.innerHTML = '';
    pages.forEach((page, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot';
      b.setAttribute('aria-label', `Go to page ${i + 1}: ${page.dataset.title}`);
      b.addEventListener('click', () => goToPage(i));
      dotsEl.appendChild(b);
    });
  }

  function updateUI(f) {
    const vis = visiblePages(f);
    dotsEl.querySelectorAll('.dot').forEach((d, i) => {
      const on = vis.includes(i);
      d.classList.toggle('is-active', on);
      if (on) d.setAttribute('aria-current', 'page');
      else d.removeAttribute('aria-current');
    });
    const nums = vis.map((i) => i + 1).join('–');
    const showHint = f === 0 && !opened;
    counter.classList.toggle('is-hint', showHint);
    counter.textContent = showHint
      ? 'Tap or swipe to open ♡'
      : `${nums} / ${pages.length} · ${pages[vis[vis.length - 1]].dataset.title}`;
    prevBtn.disabled = f <= 0;
    nextBtn.disabled = f >= maxFlipped();
  }

  // Pages in view get .is-visible so their entrance animations play.
  function markVisible(f, adding = false) {
    const vis = visiblePages(f);
    pages.forEach((p, i) => {
      const on = vis.includes(i);
      if (on && !p.classList.contains('is-visible')) {
        p.classList.add('is-visible');
        onPageShown(p);
      } else if (!on && !adding) {
        p.classList.remove('is-visible');
      }
    });
  }

  function onPageShown(page) {
    if (page.querySelector('#priceNum')) {
      countUp(page.querySelector('#priceNum'));
      burstHearts(page.querySelector('#hearts'));
    }
  }

  function hideHint() {
    opened = true;
  }

  /* ---------------------------------------------------------------- input */

  book.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || busy || e.target.closest('a, button')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), leaf: null, moved: false, p: 0 };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;

    if (!drag.moved) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
        if (Math.abs(dy) > 14) drag = null; // vertical gesture, let it go
        return;
      }
      drag.moved = true;
      drag.dir = dx < 0 ? 1 : -1;
      const canTurn = drag.dir > 0 ? flipped < maxFlipped() : flipped > 0;
      if (!canTurn) return;
      drag.leaf = drag.dir > 0 ? leaves[flipped] : leaves[flipped - 1];
      busy = true;
      book.classList.add('is-dragging');
      restack(drag.leaf);
      // on a phone, bring the page round from behind the book to where it can be dragged in
      if (drag.dir < 0 && mode === 'single') setAngle(drag.leaf, -180);
      markVisible(flipped + drag.dir, true); // pages peeking out from under the drag
      hideHint();
    }
    if (!drag.leaf) return;

    const span = mode === 'spread' ? pw * 1.5 : pw * 0.9;
    drag.p = clamp((drag.dir > 0 ? -dx : dx) / span, 0, 1);
    setAngle(drag.leaf, drag.dir > 0 ? -180 * drag.p : -180 * (1 - drag.p));
    castShadow(drag.leaf);
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    book.classList.remove('is-dragging');

    if (!d.moved) {
      if (cancelled) return;
      const r = book.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (mode === 'spread') turn(x >= 0.5 ? 1 : -1);
      else turn(x >= 0.3 ? 1 : -1);
      return;
    }
    if (!d.leaf) {
      bump(d.dir);
      return;
    }

    const quick = performance.now() - d.t < 320 && d.p > 0.06;
    const done = !cancelled && (d.p > 0.45 || quick);
    busy = false;
    if (done) animate(d.leaf, d.dir > 0 ? turnedAngle() : 0, FLIP_MS * 0.8, d.dir);
    else animate(d.leaf, d.dir > 0 ? 0 : turnedAngle(), FLIP_MS * 0.6, 0);
  }

  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));

  prevBtn.addEventListener('click', () => turn(-1));
  nextBtn.addEventListener('click', () => turn(1));

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && e.target === document.body)) {
      e.preventDefault();
      turn(1);
    } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      turn(-1);
    } else if (e.key === 'Home') {
      goToPage(0);
    } else if (e.key === 'End') {
      goToPage(pages.length - 1);
    }
  });

  book.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]');
    if (btn) goToPage(Number(btn.dataset.goto));
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function relayout() {
      if (busy) resizeTimer = setTimeout(relayout, 200);
      else layout();
    }, 120);
  });

  /* ---------------------------------------------------------------- extras */

  function countUp(el) {
    const end = Number(el.dataset.value);
    if (reduceMotion.matches) {
      el.textContent = end;
      return;
    }
    const start = performance.now();
    const dur = 1300;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    setTimeout(() => requestAnimationFrame(tick), 450);
  }

  function burstHearts(box) {
    if (reduceMotion.matches) return;
    box.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.textContent = '♥';
      s.style.left = `${30 + Math.random() * 40}%`;
      s.style.fontSize = `${3 + Math.random() * 4}cqw`;
      s.style.setProperty('--x', `${(Math.random() - 0.5) * 40}cqw`);
      s.style.setProperty('--r', `${(Math.random() - 0.5) * 60}deg`);
      s.style.setProperty('--d', `${0.6 + Math.random() * 0.9}s`);
      s.style.setProperty('--t', `${1.8 + Math.random() * 1.4}s`);
      box.appendChild(s);
    }
  }

  // EAN-13 barcode drawn as SVG.
  function drawBarcode(el, digits12) {
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const R = L.map((c) => c.replace(/./g, (b) => (b === '1' ? '0' : '1')));
    const G = R.map((c) => c.split('').reverse().join(''));
    const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

    const d = digits12.replace(/\D/g, '').padEnd(12, '0').slice(0, 12).split('').map(Number);
    const sum = d.reduce((s, v, i) => s + v * (i % 2 ? 3 : 1), 0);
    d.push((10 - (sum % 10)) % 10);

    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[d[i]];
    bits += '101';

    const quiet = 9;
    const width = 95 + quiet + 5;
    const barH = 58;
    const guards = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
    let rects = '';
    let n = 0;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      let j = i;
      while (bits[j + 1] === '1') j++;
      const h = guards.has(i) ? barH + 6 : barH;
      rects += `<rect class="bar" style="--i:${n++}" x="${quiet + i}" y="2" width="${j - i + 1}" height="${h}"/>`;
      i = j;
    }
    const y = barH + 10.5;
    let text = `<text x="${quiet - 6}" y="${y}">${d[0]}</text>`;
    for (let i = 1; i <= 6; i++) text += `<text x="${quiet + 3 + (i - 1) * 7 + 0.6}" y="${y}">${d[i]}</text>`;
    for (let i = 7; i <= 12; i++) text += `<text x="${quiet + 50 + (i - 7) * 7 + 0.6}" y="${y}">${d[i]}</text>`;

    el.insertAdjacentHTML(
      'afterbegin',
      `<svg viewBox="0 0 ${width} ${barH + 13}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}${text}</svg>`
    );
    el.setAttribute('aria-label', `Product barcode ${d.join('')}`);
  }

  async function share() {
    const data = { title: document.title, text: 'A Little Yarn, A Lot of Love ♡', url: location.href };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(location.href);
      showToast('Link copied ♡');
    } catch (err) {
      if (err && err.name !== 'AbortError') showToast('Couldn’t share, copy the link from the address bar');
    }
  }

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 2200);
  }

  function setupFullscreen() {
    const btn = $('#fsBtn');
    const root = document.documentElement;
    if (!root.requestFullscreen) {
      btn.hidden = true;
      return;
    }
    btn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen().catch(() => {});
    });
  }

  // Floating hearts and yarn fluff in the background.
  function startSky() {
    const canvas = $('#sky');
    const ctx = canvas.getContext('2d');
    let w = 0;
    let h = 0;
    let dpr = 1;
    let bits = [];
    let raf = 0;

    const heart = (x, y, s) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.3);
      ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.1, x - s * 0.5, y + s * 0.25);
      ctx.bezierCurveTo(x - s * 0.5, y + s * 0.55, x - s * 0.1, y + s * 0.7, x, y + s * 0.9);
      ctx.bezierCurveTo(x + s * 0.1, y + s * 0.7, x + s * 0.5, y + s * 0.55, x + s * 0.5, y + s * 0.25);
      ctx.bezierCurveTo(x + s * 0.5, y - s * 0.1, x, y, x, y + s * 0.3);
      ctx.fill();
    };

    const spawn = (anywhere) => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 20,
      s: 5 + Math.random() * 12,
      v: 0.15 + Math.random() * 0.35,
      sway: Math.random() * Math.PI * 2,
      kind: Math.random() < 0.55 ? 'heart' : 'fluff',
      a: 0.08 + Math.random() * 0.22,
    });

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(clamp((w * h) / 38000, 12, 34));
      bits = Array.from({ length: count }, () => spawn(true));
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.y -= b.v;
        b.sway += 0.01;
        const x = b.x + Math.sin(b.sway) * 14;
        if (b.kind === 'heart') {
          ctx.fillStyle = `rgba(217, 135, 140, ${b.a})`;
          heart(x, b.y, b.s);
        } else {
          ctx.fillStyle = `rgba(246, 236, 220, ${b.a * 0.7})`;
          ctx.beginPath();
          ctx.arc(x, b.y, b.s * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
        if (b.y < -30) Object.assign(b, spawn(false));
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener('resize', resize);
    if (reduceMotion.matches) {
      frame();
      cancelAnimationFrame(raf);
      return;
    }
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    });
    raf = requestAnimationFrame(frame);
  }

  function whenImagesReady(timeout) {
    const imgs = Array.from(document.images);
    const extra = ['assets/images/paper.jpg'].map((src) => {
      const i = new Image();
      i.src = src;
      return i;
    });
    const waits = imgs.concat(extra).map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    );
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    return Promise.race([
      Promise.all([...waits, fonts]),
      new Promise((r) => setTimeout(r, timeout)),
    ]);
  }

  /* ---------------------------------------------------------------- start */

  drawBarcode($('#barcode'), BARCODE_DIGITS);
  $('#shareBtn').addEventListener('click', share);
  setupFullscreen();
  layout();
  startSky();

  whenImagesReady(6000).then(() => {
    document.body.classList.add('is-ready');
  });
})();
