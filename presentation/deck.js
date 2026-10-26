/* Loopie presentation: a flip-through booklet that opens like an Arabic book.
 *
 * Same page-turning engine as the website's booklet (assets/js/booklet.js),
 * mirrored so the spine sits on the right and pages turn from left to right.
 * Wide screens show two pages side by side; phones show one page at a time.
 */
(() => {
  'use strict';

  const RATIO = 3 / 4;        // page width / page height
  const MAX_PAGE_W = 820;     // px; big enough to fill a projector
  const FLIP_MS = 1100;       // one full page turn
  const QUICK_FLIP_MS = 480;  // used when jumping several pages at once
  const RTL = document.documentElement.dir === 'rtl';

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

  let mode = null;       // 'spread' | 'single'
  let leaves = [];       // { el, front, back, angle }
  let flipped = 0;       // how many leaves have been turned over
  let pw = 0;            // page width in px
  let busy = false;
  let queue = [];
  let drag = null;
  let activeLeaf = null; // the leaf currently turning
  let opened = false;    // has anyone turned a page yet?

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  /* ---------------------------------------------------------------- layout */

  const maxFlipped = () => (mode === 'spread' ? leaves.length : leaves.length - 1);

  // On a phone there is no facing page to land on, so a turned page keeps
  // going round the spine and folds away behind the book.
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
    updateUI(flipped);
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
  // The whole book is mirrored for right-to-left, and each page is mirrored
  // back in CSS so its content reads normally.
  function shiftBook(f, ms) {
    let shift = 0;
    let state = 'open';
    if (mode === 'spread') {
      if (f === 0) { shift = -pw / 2; state = 'start'; }
      else if (f === leaves.length) { shift = pw / 2; state = 'end'; }
    }
    book.style.setProperty('--shift-ms', `${ms}ms`);
    book.style.transform = `${RTL ? 'scaleX(-1) ' : ''}translateX(${shift}px)`;
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
    const from = leaf.angle;
    const sweep = Math.abs(to - from);
    const fullCircle = sweep > 180; // phones only
    const duration = reduceMotion.matches ? 0 : Math.max(180, (ms * sweep) / (fullCircle ? 360 : 180));
    const target = flipped + commitDir;
    if (commitDir) {
      updateUI(target);
      // the page riding on the turning leaf only lands at the end, so its animations wait for it
      const landing = (commitDir > 0 ? leaf.back : leaf.front).querySelector('.page');
      markVisible(target, true, landing, duration * 0.6);
      shiftBook(target, ms);
    }
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
    opened = true;
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
    const px = dir * (RTL ? 10 : -10);
    book.animate(
      [{ translate: '0 0' }, { translate: `${px}px 0` }, { translate: '0 0' }],
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
      b.setAttribute('aria-label', `روح لصفحة ${i + 1}: ${page.dataset.title}`);
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
      ? 'دوس على الغلاف عشان يفتح ♡'
      : `صفحة ${nums} من ${pages.length} · ${pages[vis[0]].dataset.title}`;
    prevBtn.disabled = f <= 0;
    nextBtn.disabled = f >= maxFlipped();
  }

  // Pages in view get .is-visible so their entrance animations play.
  function markVisible(f, adding = false, landing = null, landingDelay = 0) {
    const vis = visiblePages(f);
    pages.forEach((p, i) => {
      const on = vis.includes(i);
      if (on && !p.classList.contains('is-visible')) {
        const base = p === landing ? Math.round(landingDelay) : 0;
        p.style.setProperty('--base', `${base}ms`);
        p.classList.add('is-visible');
        onPageShown(p, base);
      } else if (!on && !adding) {
        p.classList.remove('is-visible');
      }
    });
  }

  function onPageShown(page, base) {
    page.querySelectorAll('[data-count]').forEach((el) => countUp(el, base + Number(el.dataset.delay || 0)));
  }

  /* ---------------------------------------------------------------- input */

  book.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || busy || e.target.closest('a, button')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), leaf: null, moved: false, p: 0 };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) * (RTL ? -1 : 1); // in book space
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
      opened = true;
      book.classList.add('is-dragging');
      restack(drag.leaf);
      // on a phone, bring the page round from behind the book to where it can be dragged in
      if (drag.dir < 0 && mode === 'single') setAngle(drag.leaf, -180);
      markVisible(flipped + drag.dir, true); // pages peeking out from under the drag
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
      let x = (e.clientX - r.left) / r.width;
      if (RTL) x = 1 - x;
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

  // Presentation keys: arrows, Page Up/Down (what most clickers send), Space, F for full screen.
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onButton = e.target.closest && e.target.closest('button');
    if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) || (!onButton && [' ', 'Enter'].includes(e.key))) {
      e.preventDefault();
      turn(1);
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      turn(-1);
    } else if (e.key === 'Home') {
      goToPage(0);
    } else if (e.key === 'End') {
      goToPage(pages.length - 1);
    } else if (e.key === 'f' || e.key === 'F' || e.key === 'ب') {
      toggleFullscreen();
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

  function countUp(el, delay) {
    const end = Number(el.dataset.count);
    if (reduceMotion.matches) {
      el.textContent = end;
      return;
    }
    const dur = 1200;
    el.textContent = '0';
    setTimeout(() => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / dur);
        el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
  }

  function toggleFullscreen() {
    const root = document.documentElement;
    if (!root.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen().catch(() => {});
  }

  function setupFullscreen() {
    const btn = $('#fsBtn');
    if (!document.documentElement.requestFullscreen) {
      btn.hidden = true;
      return;
    }
    btn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      document.body.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
    });
    // while presenting full screen, hide the cursor and controls when the mouse rests
    let idleTimer;
    const wake = () => {
      document.body.classList.remove('is-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.body.classList.add('is-idle'), 2500);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    wake();
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
    const extra = ['../assets/images/paper.jpg'].map((src) => {
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

  if (RTL) book.classList.add('is-rtl');
  setupFullscreen();
  layout();
  startSky();

  whenImagesReady(6000).then(() => {
    document.body.classList.add('is-ready');
  });
})();
