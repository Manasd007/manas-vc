const EASE = {
  expoOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  expoIn: "cubic-bezier(0.7, 0, 0.84, 0)",
  inOut: "cubic-bezier(0.76, 0, 0.24, 1)",
  softOut: "cubic-bezier(0.33, 1, 0.68, 1)",
  softIn: "cubic-bezier(0.32, 0, 0.67, 0)",
};

const SNAKE_POINTS = [
  [-80, 560], [320, 560], [320, 240], [640, 240], [640, 720], [960, 720],
  [960, 160], [1200, 160], [1200, 480], [1440, 480], [1440, 240], [1680, 240],
];

function roundedPath(points, radius) {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [cx, cy] = points[i], [nx, ny] = points[i + 1];
    const inLen = Math.hypot(cx - px, cy - py), outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    d += ` L ${cx + ((px - cx) / inLen) * r} ${cy + ((py - cy) / inLen) * r}`;
    d += ` Q ${cx} ${cy} ${cx + ((nx - cx) / outLen) * r} ${cy + ((ny - cy) / outLen) * r}`;
  }
  const [ex, ey] = points[points.length - 1];
  return `${d} L ${ex} ${ey}`;
}

function scene(tone) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", `intro-scene intro-scene-${tone}`);
  svg.setAttribute("viewBox", "0 0 1600 900");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  const d = roundedPath(SNAKE_POINTS, 28);
  svg.innerHTML = `
    <defs>
      <pattern id="grid-${tone}" width="80" height="80" patternUnits="userSpaceOnUse">
        <path d="M 80 0 L 0 0 0 80" fill="none" class="intro-grid-line"/>
      </pattern>
      <radialGradient id="fade-${tone}" cx="50%" cy="50%" r="75%">
        <stop offset="0%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="55%" stop-color="#fff" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <mask id="mask-${tone}"><rect width="1600" height="900" fill="url(#fade-${tone})"/></mask>
    </defs>
    <g mask="url(#mask-${tone})">
      <rect width="1600" height="900" fill="url(#grid-${tone})"/>
      <path class="intro-snake intro-snake-echo" d="${d}"/>
      <path class="intro-snake intro-snake-main" d="${d}"/>
    </g>`;
  return svg;
}

export function runIntro(root, { onEnter, afterExit, page }) {
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  $(".intro-cream").prepend(scene("cream"));
  $(".intro-dark").prepend(scene("dark"));

  const logo = $(".intro-logo");
  logo.innerHTML = "";
  for (const ch of logo.dataset.text) {
    const span = document.createElement("span");
    span.className = "intro-char";
    span.textContent = ch === " " ? "\u00a0" : ch;
    logo.append(span);
  }

  const animator = (list) => (el, frames, { at = 0, dur = 1, ease = EASE.expoOut, fill = "both" } = {}) => {
    list.push(el.animate(frames, { duration: dur * 1000, delay: at * 1000, easing: ease, fill }));
  };
  const timeline = [];
  const play = animator(timeline);
  const each = (els, frames, opts, stagger) => els.forEach((el, i) => play(el, frames, { ...opts, at: opts.at + i * stagger }));

  for (const path of $$(".intro-snake")) {
    const total = path.getTotalLength();
    const seg = total * 0.2, period = total + seg;
    const start = path.classList.contains("intro-snake-echo") ? seg - period / 2 : seg;
    path.style.strokeDasharray = `${seg} ${total}`;
    if (reduced) continue;
    path.animate(
      [{ strokeDashoffset: start }, { strokeDashoffset: start - period }],
      { duration: 16000, iterations: Infinity },
    );
  }

  const button = $(".intro-cta");
  const dark = $(".intro-dark");
  const up = (from) => [{ transform: `translateY(${from}px)`, opacity: 0 }, { transform: "none", opacity: 1 }];

  if (reduced) {
    root.classList.add("is-static");
  } else {
    $$(".intro-scene-cream").forEach((el) => play(el, [{ opacity: 0 }, { opacity: 1 }], { at: 0.1, dur: 1.4, ease: EASE.softOut }));
    each($$(".intro-char"), [
      { transform: "translateY(118%) rotate(5deg)" },
      { transform: "none" },
    ], { at: 0.3, dur: 1.15 }, 0.045);
    each($$(".intro-meta"), up(14), { at: 0.9, dur: 0.9 }, 0.12);

    each($$(".intro-char"), [{ transform: "none" }, { transform: "translateY(-125%)" }],
      { at: 2.5, dur: 0.65, ease: EASE.expoIn, fill: "forwards" }, 0.025);
    each($$(".intro-meta"), [{ opacity: 1 }, { opacity: 0, transform: "translateY(-12px)" }],
      { at: 2.5, dur: 0.45, ease: EASE.softIn, fill: "forwards" }, 0);
    play(dark, [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { at: 2.85, dur: 1.15, ease: EASE.inOut, fill: "forwards" });

    play($(".intro-mark"), up(18), { at: 3.5, dur: 0.85, ease: EASE.softOut });
    each($$(".intro-line-inner"), [{ transform: "translateY(115%)" }, { transform: "none" }], { at: 3.58, dur: 1.15 }, 0.13);
    play(button, up(18), { at: 4.0, dur: 0.85, ease: EASE.softOut });

    const skip = (e) => {
      if (button.contains(e.target)) return;
      for (const a of timeline) a.finish();
      stopSkipping();
      button.focus({ preventScroll: true });
    };
    const stopSkipping = () => {
      root.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip, true);
    };
    root.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip, true);
    Promise.all(timeline.map((a) => a.finished)).then(stopSkipping, stopSkipping);
  }

  button.addEventListener("click", () => {
    onEnter?.();
    button.disabled = true;
    if (reduced) {
      root.remove();
      afterExit?.();
      return;
    }
    const out = [];
    const go = animator(out);
    const away = { fill: "forwards" };

    $$(".intro-line-inner").forEach((el, i) => go(el, [{ transform: "none" }, { transform: "translateY(-115%)" }], { ...away, at: i * 0.07, dur: 0.6, ease: EASE.expoIn }));
    for (const el of [$(".intro-mark"), button]) go(el, [{ opacity: 1 }, { opacity: 0, transform: "translateY(-14px)" }], { ...away, at: 0.05, dur: 0.45, ease: EASE.softIn });
    go($(".intro-scene-dark"), [{ opacity: 1 }, { opacity: 0 }], { ...away, at: 0.05, dur: 0.6, ease: EASE.softIn });
    go($(".intro-center"), [{ transform: "none" }, { transform: "translateY(-50px)" }], { ...away, at: 0.5, ease: EASE.inOut });
    go(root, [{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 100% 0)" }], { ...away, at: 0.5, ease: EASE.inOut });
    for (const el of page) {
      el.style.transformOrigin = "50% 40%";
      go(el, [{ transform: "scale(1.02)" }, { transform: "none" }], { at: 0.6, dur: 1.15, fill: "backwards" });
    }
    Promise.all(out.map((a) => a.finished)).finally(() => {
      for (const el of page) el.style.transformOrigin = "";
      root.remove();
      afterExit?.();
    });
  });

  if (reduced) button.focus({ preventScroll: true });
}
