// Figma-runtime script. It is serialised into a `use_figma` call by build-calls.mjs and never runs in Node.
// `figma` is the Figma plugin global and `D` is the data constant build-calls.mjs prepends to the call text.
// It draws one batch of captured screens (sections of frames) onto one Figma page, binding colours to the
// "Live · Base" and "Live · Area" variables, text to the local text styles and icons to the icon components.
// Keep it free of imports and Node APIs: it must stay valid inside Figma's plugin runtime.
export default async function build(figma, D) {
  const page = await figma.getNodeByIdAsync(D.page);
  await figma.setCurrentPageAsync(page);
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const baseC = cols.find((c) => c.name === "Live · Base"),
    areaC = cols.find((c) => c.name === "Live · Area");
  const modeId = areaC.modes.find((m) => m.name === D.mode).modeId;
  const h2 = (x) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  const hexOf = (c) => "#" + h2(c.r) + h2(c.g) + h2(c.b) + (c.a < 0.999 ? h2(c.a) : "");
  const VM = {};
  for (const id of areaC.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    const k = hexOf(v.valuesByMode[modeId]);
    if (!VM[k]) VM[k] = v;
  }
  const bm = baseC.modes[0].modeId;
  for (const id of baseC.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    const k = hexOf(v.valuesByMode[bm]);
    if (!VM[k]) VM[k] = v;
  }
  const TS = {};
  for (const s of await figma.getLocalTextStylesAsync()) {
    const m = /key:(\S+)/.exec(s.description);
    if (m) TS[m[1]] = s.id;
  }
  const ES = {},
    EFX = {};
  for (const s of await figma.getLocalEffectStylesAsync()) {
    ES[s.name] = s.id;
    EFX[s.name] = s.effects;
  }
  const iconsPage = await figma.getNodeByIdAsync("7:3");
  await iconsPage.loadAsync();
  const IC = {};
  for (const c of iconsPage.findAllWithCriteria({ types: ["COMPONENT"] })) IC[c.name.slice(5)] = c;
  const WN = {
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    650: "SemiBold",
    700: "Bold",
    750: "Bold",
    800: "ExtraBold",
    900: "Black",
  };
  const fontsNeeded = new Set();
  for (const s of D.sections) for (const f of s.frames) for (const t of f.t) fontsNeeded.add(WN[t[1]] || "Regular");
  for (const st of fontsNeeded) await figma.loadFontAsync({ family: "Geist", style: st });
  const rgb = (h) => ({
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
  });
  const paint = (h) => {
    const p = { type: "SOLID", color: rgb(h), opacity: h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1 };
    const v = VM[h];
    return v ? figma.variables.setBoundVariableForPaint({ ...p, opacity: 1 }, "color", v) : p;
  };
  const missingIcons = new Set();
  let count = 0;
  function grad(F, g) {
    const a = (g[0] * Math.PI) / 180;
    const x1 = 0.5 - Math.sin(a) / 2,
      y1 = 0.5 + Math.cos(a) / 2,
      x2 = 0.5 + Math.sin(a) / 2,
      y2 = 0.5 - Math.cos(a) / 2;
    const dx = x2 - x1,
      dy = y2 - y1,
      L = dx * dx + dy * dy;
    return {
      type: "GRADIENT_LINEAR",
      gradientTransform: [
        [dx / L, dy / L, -(dx * x1 + dy * y1) / L],
        [-dy / L, dx / L, 0.5 - (-dy * x1 + dx * y1) / L],
      ],
      gradientStops: g[1].map(([ci, p]) => {
        const h = F.c[ci];
        const c = rgb(h);
        return { position: p, color: { ...c, a: h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1 } };
      }),
    };
  }
  async function build(F, list, parent) {
    for (const n of list) {
      count++;
      if (typeof n[0] === "string" && n.length === 2) {
        const before = parent.children.length;
        await build(F, n[1], parent);
        const kids = parent.children.slice(before);
        if (kids.length > 1) {
          const g = figma.group(kids, parent);
          g.name = n[0];
        }
      } else if (typeof n[0] === "string") {
        const [s, x, y, w, h, ti, ci, fl] = n;
        // `mono` is kept so the destructuring matches the layout of a text style row (size, weight, mono, line, spacing).
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const [f, wt, mono, lh0, ls] = F.t[ti];
        const lh = lh0 || Math.round(f * 1.2 * 10) / 10;
        const t = figma.createText();
        parent.appendChild(t);
        t.fontName = { family: "Geist", style: WN[wt] || "Regular" };
        t.characters = s;
        const sid = TS[`${f}|${wt}|${lh0}|${ls}`];
        if (sid) await t.setTextStyleIdAsync(sid);
        else {
          t.fontSize = f;
          t.lineHeight = { unit: "PIXELS", value: lh };
          if (ls) t.letterSpacing = { unit: "PIXELS", value: ls };
        }
        t.fills = [paint(ci >= 0 ? F.c[ci] : "#475467")];
        if (fl & 1) {
          t.textAutoResize = "HEIGHT";
          t.resize(Math.max(1, w + 1), Math.max(1, h));
          t.textAlignHorizontal = fl & 2 ? "CENTER" : fl & 4 ? "RIGHT" : "LEFT";
          t.x = x;
          t.y = y + (1.3 * f - lh) / 2;
        } else if (fl & 8) {
          t.textAutoResize = "NONE";
          t.resize(Math.max(1, w + 1), lh);
          t.textTruncation = "ENDING";
          t.x = x;
          t.y = y + h / 2 - lh / 2;
        } else {
          t.textAutoResize = "WIDTH_AND_HEIGHT";
          t.x = x;
          t.y = y + h / 2 - lh / 2;
        }
        t.name = s.length > 40 ? s.slice(0, 40) + "…" : s;
      } else if (typeof n[1] === "number") {
        const [ii, x, y, w, h, ci, op] = n;
        const comp = IC[F.i[ii]];
        if (!comp) {
          missingIcons.add(F.i[ii]);
          continue;
        }
        const inst = comp.createInstance();
        parent.appendChild(inst);
        inst.x = x;
        inst.y = y;
        if (Math.abs(inst.width - w) > 0.5 || Math.abs(inst.height - h) > 0.5)
          inst.resize(Math.max(0.1, w), Math.max(0.1, h));
        if (ci >= 0) {
          const col = paint(F.c[ci]);
          for (const v of inst.findAll((q) => "fills" in q && q.type !== "INSTANCE" && q.type !== "FRAME")) {
            const blk = (ps) =>
              ps !== figma.mixed && ps.some((p) => p.type === "SOLID" && p.color.r + p.color.g + p.color.b < 0.01);
            if (blk(v.fills))
              v.fills = v.fills.map((p) => (p.type === "SOLID" && p.color.r + p.color.g + p.color.b < 0.01 ? col : p));
            if (blk(v.strokes))
              v.strokes = v.strokes.map((p) =>
                p.type === "SOLID" && p.color.r + p.color.g + p.color.b < 0.01 ? col : p,
              );
          }
        }
        if (op) inst.opacity = op;
      } else {
        const [, name, x, y, w, h, si, kids] = n;
        const st = F.s[si] || {};
        const fr = figma.createFrame();
        parent.appendChild(fr);
        fr.name = name;
        fr.x = x;
        fr.y = y;
        fr.resize(Math.max(0.1, w), Math.max(0.1, h));
        const fills = [];
        if (st.b !== undefined) fills.push(paint(F.c[st.b]));
        if (st.g) fills.push(grad(F, st.g));
        if (name === "img") fills.push({ type: "SOLID", color: rgb("#e2e8f0") });
        fr.fills = fills;
        fr.clipsContent = !!st.k;
        if (st.r) {
          if (Array.isArray(st.r)) {
            fr.topLeftRadius = st.r[0];
            fr.topRightRadius = st.r[1];
            fr.bottomRightRadius = st.r[2];
            fr.bottomLeftRadius = st.r[3];
          } else fr.cornerRadius = st.r;
        }
        if (st.d) {
          fr.strokes = [paint(F.c[st.d[0]])];
          fr.strokeAlign = "INSIDE";
          if (Array.isArray(st.d[1])) {
            fr.strokeTopWeight = st.d[1][0];
            fr.strokeRightWeight = st.d[1][1];
            fr.strokeBottomWeight = st.d[1][2];
            fr.strokeLeftWeight = st.d[1][3];
          } else fr.strokeWeight = st.d[1];
          if (st.d[2]) fr.dashPattern = [4, 3];
        }
        const fx = [];
        if (st.l) fx.push({ type: "BACKGROUND_BLUR", radius: st.l, visible: true });
        if (st.s && !st.l) await fr.setEffectStyleIdAsync(ES[st.s === 2 ? "Live/Float shadow" : "Live/Card shadow"]);
        else if (st.s) fx.unshift(...EFX[st.s === 2 ? "Live/Float shadow" : "Live/Card shadow"]);
        if (fx.length) fr.effects = fx;
        if (st.o) fr.opacity = st.o;
        await build(F, kids, fr);
      }
    }
  }
  const out = [];
  for (const sec of D.sections) {
    let section,
      x = 80;
    if (sec.cont) {
      section = page.children.find((q) => q.type === "SECTION" && q.name === sec.name);
      for (const c of section.children) x = Math.max(x, c.x + c.width + 120);
    } else {
      section = figma.createSection();
      section.name = sec.name;
    }
    const made = [];
    for (const F of sec.frames) {
      const root = figma.createFrame();
      section.appendChild(root);
      root.name = F.label;
      root.x = x;
      root.y = 120;
      root.resize(F.w, F.h);
      root.fills = [paint(F.bg)];
      root.clipsContent = true;
      root.setExplicitVariableModeForCollection(areaC, modeId);
      await build(F, F.n, root);
      made.push(root.id);
      x += F.w + 120;
    }
    section.resizeWithoutConstraints(x - 40, sec.hmax + 200);
    section.x = 0;
    section.y = sec.y;
    out.push({ section: section.id, frames: made });
  }
  return { out, nodes: count, missingIcons: [...missingIcons] };
}
