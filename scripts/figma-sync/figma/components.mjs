// Figma-runtime script. Serialised into a `use_figma` call by build-calls.mjs (--components); never runs in Node.
// Rebuilds the "Components" page (Figma node 23:2): reusable auto-layout components bound to the
// "Live · Base" and "Live · Area" variables. It clears the page first, so run it only to rebuild the whole page.
// Keep it free of imports and Node APIs: it must stay valid inside Figma's plugin runtime.
export default async function components(figma) {
  // Builds the "Components" page: reusable, auto-layout components bound to Live variables.
  let page = figma.root.children.find((p) => p.name === "Components");
  if (!page) {
    page = figma.createPage();
    page.name = "Components";
    const ic = figma.root.children.findIndex((p) => p.id === "7:3");
    figma.root.insertChild(ic + 1, page);
  }
  await figma.setCurrentPageAsync(page);
  for (const c of [...page.children]) c.remove();
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const areaC = cols.find((c) => c.name === "Live · Area");
  const V = {};
  for (const c of cols.filter((c) => c.name.startsWith("Live")))
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      V[v.name] = v;
    }
  for (const st of ["Regular", "Medium", "SemiBold", "Bold"]) await figma.loadFontAsync({ family: "Geist", style: st });
  const iconsPage = await figma.getNodeByIdAsync("7:3");
  await iconsPage.loadAsync();
  const IC = {};
  for (const c of iconsPage.findAllWithCriteria({ types: ["COMPONENT"] })) IC[c.name.slice(5)] = c;
  const rgb = (h) => ({
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
  });
  const P = (name, fallback) => {
    const v = V[name];
    const p = { type: "SOLID", color: rgb(fallback || "#000000") };
    if (fallback && fallback.length > 7) p.opacity = parseInt(fallback.slice(7, 9), 16) / 255;
    return v ? figma.variables.setBoundVariableForPaint(p, "color", v) : p;
  };
  const WT = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
  const text = (s, size, wt, colorVar, opts = {}) => {
    const t = figma.createText();
    t.fontName = { family: "Geist", style: WT[wt] };
    t.characters = s;
    t.fontSize = size;
    t.lineHeight = { unit: "PIXELS", value: opts.lh || Math.round(size * 1.35) };
    if (opts.ls) t.letterSpacing = { unit: "PIXELS", value: opts.ls };
    if (opts.upper) t.textCase = "UPPER";
    t.fills = [P(colorVar)];
    t.name = opts.name || s;
    return t;
  };
  const icon = (key, colorVar, size) => {
    const i = IC[key].createInstance();
    if (size) i.resize(size, size);
    if (colorVar) {
      const col = P(colorVar);
      for (const v of i.findAll((q) => "fills" in q && q.type !== "INSTANCE")) {
        const fix = (ps) =>
          ps !== figma.mixed &&
          ps.map((p) => (p.type === "SOLID" && p.color.r + p.color.g + p.color.b < 0.01 ? col : p));
        if (v.fills !== figma.mixed && v.fills.length) v.fills = fix(v.fills);
        if (v.strokes.length) v.strokes = fix(v.strokes);
      }
    }
    return i;
  };
  const al = (dir, props = {}) => {
    const f = figma.createAutoLayout(dir);
    f.fills = [];
    Object.assign(f, props);
    return f;
  };
  const shadow = (await figma.getLocalEffectStylesAsync()).find((s) => s.name === "Live/Card shadow");
  const made = {};
  let X = 0,
    Y = 0;
  const place = (n, w) => {
    page.appendChild(n);
    n.x = X;
    n.y = Y;
    made[n.name] = n.id;
    X += (w || n.width) + 80;
  };
  const row = () => {
    X = 0;
    Y += 220;
  };
  const comp = (node, name, desc) => {
    const c = figma.createComponentFromNode(node);
    c.name = name;
    if (desc) c.description = desc;
    return c;
  };
  const setOf = (comps, name, desc) => {
    const s = figma.combineAsVariants(comps, page);
    s.name = name;
    if (desc) s.description = desc;
    s.layoutMode = "HORIZONTAL";
    s.itemSpacing = 24;
    s.paddingLeft = s.paddingRight = s.paddingTop = s.paddingBottom = 24;
    s.layoutWrap = "WRAP";
    s.counterAxisSpacing = 24;
    s.primaryAxisSizingMode = "AUTO";
    s.counterAxisSizingMode = "AUTO";
    s.fills = [];
    s.strokes = [P("border/default", "#e2e8f0")];
    s.dashPattern = [6, 4];
    s.cornerRadius = 12;
    return s;
  };

  // Buttons
  const btns = [];
  for (const [kind, bg, fg, stroke] of [
    ["Primary", "area/identity", "area/on-identity"],
    ["Secondary", "surface/raised", "text/heading", "border/default"],
    ["Soft", "area/soft", "area/identity"],
    ["Warning", "status/warning-bg", "status/warning-text", "status/warning-border"],
  ]) {
    for (const [size, h, px, fs] of [
      ["Large", 48, 20, 13],
      ["Small", 28, 12, 12],
    ]) {
      const b = al("HORIZONTAL", {
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "CENTER",
        paddingLeft: px,
        paddingRight: px,
        itemSpacing: 6,
      });
      b.fills = [P(bg)];
      if (stroke) {
        b.strokes = [P(stroke)];
        b.strokeWeight = 1;
        b.strokeAlign = "INSIDE";
      }
      b.counterAxisSizingMode = "FIXED";
      b.resize(100, h);
      b.primaryAxisSizingMode = "AUTO";
      b.cornerRadius = h / 2;
      b.appendChild(
        text(kind === "Warning" ? "Renew" : kind === "Primary" ? "Save" : "Open", fs, 600, fg, { name: "Label" }),
      );
      const c = comp(b, `Kind=${kind}, Size=${size}`);
      const tp = c.addComponentProperty("Label", "TEXT", c.children[0].characters);
      c.children[0].componentPropertyReferences = { characters: tp };
      btns.push(c);
    }
  }
  place(
    setOf(
      btns,
      "Button",
      "Pill buttons. Primary uses the area colour. Large is the 48 px tap target used across work mode.",
    ),
  );
  row();
  // Tag
  const tags = [];
  for (const [tone, bg, fg] of [
    ["Area", "area/soft", "area/identity"],
    ["Neutral", "surface/wash", "text/muted"],
    ["Warning", "status/warning-bg", "status/warning-text"],
    ["Danger", "status/danger-bg", "status/danger-text"],
  ]) {
    const t = al("HORIZONTAL", {
      counterAxisAlignItems: "CENTER",
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 2,
      paddingBottom: 2,
    });
    t.fills = [P(bg)];
    t.cornerRadius = 8;
    t.appendChild(text("In 1 h 45 min", 9.5, 700, fg, { ls: 0.6, upper: true, lh: 12.4, name: "Label" }));
    const c = comp(t, `Tone=${tone}`);
    const tp = c.addComponentProperty("Label", "TEXT", "In 1 h 45 min");
    c.children[0].componentPropertyReferences = { characters: tp };
    tags.push(c);
  }
  place(setOf(tags, "Tag", "Small status tag, capitals with letter spacing."));
  // Icon button (glass)
  const ib = al("HORIZONTAL", { primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER" });
  ib.primaryAxisSizingMode = ib.counterAxisSizingMode = "FIXED";
  ib.resize(42, 42);
  ib.cornerRadius = 21;
  ib.fills = [P("surface/glass", "#ffffffb8")];
  ib.effects = [{ type: "BACKGROUND_BLUR", radius: 18, visible: true }];
  ib.appendChild(icon("bell-16", "text/muted"));
  const ibc = comp(ib, "Icon button", "Round glass button for floating controls (header bell, menu). Swap the icon.");
  const swp = ibc.addComponentProperty("Icon", "INSTANCE_SWAP", ibc.children[0].mainComponent.id);
  ibc.children[0].componentPropertyReferences = { mainComponent: swp };
  place(ibc);
  // Area badge
  const ab = al("HORIZONTAL", { primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER" });
  ab.primaryAxisSizingMode = ab.counterAxisSizingMode = "FIXED";
  ab.resize(32, 32);
  ab.cornerRadius = 16;
  ab.fills = [P("area/identity")];
  ab.appendChild(icon("sunrise-16", "area/on-identity"));
  const abc = comp(ab, "Area badge", "Area icon in a solid area-colour circle. Colour follows the Live · Area mode.");
  const swp2 = abc.addComponentProperty("Icon", "INSTANCE_SWAP", abc.children[0].mainComponent.id);
  abc.children[0].componentPropertyReferences = { mainComponent: swp2 };
  place(abc);
  // Mode pill
  const mp = al("HORIZONTAL", { counterAxisAlignItems: "CENTER", paddingLeft: 3, paddingRight: 10, itemSpacing: 7 });
  mp.counterAxisSizingMode = "FIXED";
  mp.resize(120, 38);
  mp.primaryAxisSizingMode = "AUTO";
  mp.cornerRadius = 19;
  mp.fills = [P("surface/glass", "#ffffffb8")];
  mp.effects = [{ type: "BACKGROUND_BLUR", radius: 18, visible: true }];
  mp.appendChild(abc.createInstance());
  mp.appendChild(text("My Day", 15, 600, "area/identity", { lh: 19, name: "Area name" }));
  mp.appendChild(icon("chevron-down-14", "text/soft"));
  const mpc = comp(
    mp,
    "Mode pill",
    "Centred header pill: area badge, area name in its colour, chevron. Opens the mode picker.",
  );
  const tp3 = mpc.addComponentProperty("Area name", "TEXT", "My Day");
  mpc.children[1].componentPropertyReferences = { characters: tp3 };
  place(mpc);
  // Search field (desktop header)
  const sf = al("HORIZONTAL", { counterAxisAlignItems: "CENTER", paddingLeft: 12, paddingRight: 16, itemSpacing: 10 });
  sf.primaryAxisSizingMode = sf.counterAxisSizingMode = "FIXED";
  sf.resize(282, 42);
  sf.cornerRadius = 21;
  sf.fills = [P("surface/glass", "#ffffffb8")];
  sf.effects = [{ type: "BACKGROUND_BLUR", radius: 18, visible: true }];
  sf.appendChild(icon("glyph-20", "text/muted"));
  sf.appendChild(text("AI Search", 13, 400, "text/muted", { lh: 17 }));
  const sfc = comp(sf, "AI Search field", "Desktop header search. On phones it collapses to the glass icon button.");
  place(sfc);
  row();
  // Headers
  const hp = figma.createFrame();
  hp.name = "Header / Phone";
  hp.resize(390, 72);
  hp.fills = [P("area/band")];
  const menu = ibc.createInstance();
  menu.resize(44, 44);
  hp.appendChild(menu);
  menu.x = 18;
  menu.y = 14;
  menu.setProperties({ [swp]: IC["menu-20"].id });
  const pill = mpc.createInstance();
  hp.appendChild(pill);
  pill.y = 17;
  pill.x = Math.round((390 - pill.width) / 2);
  pill.constraints = { horizontal: "CENTER", vertical: "MIN" };
  const bell = ibc.createInstance();
  hp.appendChild(bell);
  bell.x = 275;
  bell.y = 15;
  bell.constraints = { horizontal: "MAX", vertical: "MIN" };
  const srch = ibc.createInstance();
  hp.appendChild(srch);
  srch.x = 329;
  srch.y = 15;
  srch.constraints = { horizontal: "MAX", vertical: "MIN" };
  srch.setProperties({ [swp]: IC["glyph-20"].id });
  const hpc = comp(
    hp,
    "Header / Phone",
    "Phone header: menu left, mode pill centred, bell then AI Search on the right. Background is the area band colour.",
  );
  place(hpc);
  const hd = figma.createFrame();
  hd.name = "Header / Desktop";
  hd.resize(1196, 72);
  hd.fills = [P("area/band")];
  // Back button for sub-pages (Assessments, Notifications, Open shifts, Manage team). Hidden by default.
  const back = ibc.createInstance();
  back.resize(44, 44);
  hd.appendChild(back);
  back.name = "Back";
  back.x = 26;
  back.y = 14;
  back.setProperties({ [swp]: IC["chevron-left-20"].id });
  const pill2 = mpc.createInstance();
  hd.appendChild(pill2);
  pill2.y = 17;
  pill2.x = Math.round((1196 - pill2.width) / 2);
  pill2.constraints = { horizontal: "CENTER", vertical: "MIN" };
  const bell2 = ibc.createInstance();
  hd.appendChild(bell2);
  bell2.x = 831;
  bell2.y = 15;
  bell2.constraints = { horizontal: "MAX", vertical: "MIN" };
  const sf2 = sfc.createInstance();
  hd.appendChild(sf2);
  sf2.x = 887;
  sf2.y = 15;
  sf2.constraints = { horizontal: "MAX", vertical: "MIN" };
  const hdc = comp(
    hd,
    "Header / Desktop",
    "Desktop and tablet header beside the rail: optional back button on the left, mode pill centred, bell and AI Search field on the right.",
  );
  const sb = hdc.addComponentProperty("Show back", "BOOLEAN", false);
  hdc.children.find((n) => n.name === "Back").componentPropertyReferences = { visible: sb };
  place(hdc);
  row();
  Y += 0;
  // Tabs
  const tabs = [];
  for (const st of ["Selected", "Default"]) {
    const t = al("VERTICAL", { counterAxisAlignItems: "MIN", paddingTop: 16, itemSpacing: 10.7 });
    t.appendChild(
      text("Today", 13.5, st === "Selected" ? 700 : 600, st === "Selected" ? "text/heading" : "text/muted", {
        lh: 20.3,
        name: "Label",
      }),
    );
    const u = figma.createFrame();
    u.name = "Underline";
    u.resize(40, 2);
    u.fills = [P("area/identity")];
    u.topLeftRadius = u.topRightRadius = 1;
    t.appendChild(u);
    u.layoutSizingHorizontal = "FILL";
    if (st !== "Selected") u.opacity = 0;
    const c = comp(t, `State=${st}`);
    const tp = c.addComponentProperty("Label", "TEXT", "Today");
    c.children[0].componentPropertyReferences = { characters: tp };
    tabs.push(c);
  }
  const tabSet = setOf(tabs, "Tab", "Area tab. Selected is bold with an area-colour underline.");
  place(tabSet);
  const more = al("HORIZONTAL", { counterAxisAlignItems: "MIN", paddingTop: 16, itemSpacing: 3 });
  more.appendChild(text("More", 13.5, 600, "text/muted", { lh: 20.3 }));
  const ch = icon("chevron-down-12", "text/muted");
  more.appendChild(ch);
  const morec = comp(
    more,
    "Tab / More",
    "Always the last tab. Shows the current page name when that page is not a tab.",
  );
  place(morec);
  const tb = al("HORIZONTAL", { paddingLeft: 16, itemSpacing: 20 });
  tb.name = "Tab bar";
  const sel = tabs[0],
    def = tabs[1];
  const labels = ["Today", "Week", "Hours", "Favourites"];
  labels.forEach((l, i) => {
    const inst = (i === 0 ? sel : def).createInstance();
    tb.appendChild(inst);
    inst.setProperties({ [Object.keys(inst.componentProperties).find((k) => k.startsWith("Label"))]: l });
  });
  tb.appendChild(morec.createInstance());
  const tbc = comp(tb, "Tab bar", "Area tabs. Tab count follows screen width, More is always last.");
  place(tbc);
  row();
  Y += 40;
  // Card, list row, section label
  const lr = al("HORIZONTAL", {
    counterAxisAlignItems: "CENTER",
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 12,
    paddingBottom: 12,
    itemSpacing: 12,
  });
  lr.counterAxisSizingMode = "AUTO";
  lr.primaryAxisSizingMode = "FIXED";
  lr.resize(364, 60);
  lr.strokes = [P("border/default")];
  lr.strokeTopWeight = 1;
  lr.strokeBottomWeight = lr.strokeLeftWeight = lr.strokeRightWeight = 0;
  lr.strokeAlign = "INSIDE";
  const ic = al("HORIZONTAL", { primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "CENTER" });
  ic.name = "Icon";
  ic.primaryAxisSizingMode = ic.counterAxisSizingMode = "FIXED";
  ic.resize(30, 30);
  ic.cornerRadius = 15;
  ic.fills = [P("area/soft")];
  ic.appendChild(icon("calendar-days-14", "area/identity"));
  lr.appendChild(ic);
  const tx = al("VERTICAL", { itemSpacing: 2 });
  tx.name = "Text";
  tx.appendChild(text("Research meeting", 13, 700, "text/heading", { lh: 16.3, name: "Title" }));
  tx.appendChild(text("Today 08:30 · Teaching", 11.5, 400, "text/muted", { lh: 15, name: "Detail" }));
  lr.appendChild(tx);
  tx.layoutSizingHorizontal = "FILL";
  const act = btns.find((b) => b.name === "Kind=Soft, Size=Small").createInstance();
  lr.appendChild(act);
  const lrc = comp(lr, "List row", "Row inside a card: area icon, title and detail, then an action. Top divider only.");
  const t1 = lrc.addComponentProperty("Title", "TEXT", "Research meeting");
  const t2 = lrc.addComponentProperty("Detail", "TEXT", "Today 08:30 · Teaching");
  const sh = lrc.addComponentProperty("Show action", "BOOLEAN", true);
  tx.children[0].componentPropertyReferences = { characters: t1 };
  tx.children[1].componentPropertyReferences = { characters: t2 };
  act.componentPropertyReferences = { visible: sh };
  place(lrc);
  const sl = text("Needs you", 10, 700, "text/muted", { ls: 1, upper: true, lh: 16 });
  const slf = al("HORIZONTAL", {});
  slf.appendChild(sl);
  const slc = comp(slf, "Section label", "Small capitals label above a group of cards.");
  const t3 = slc.addComponentProperty("Label", "TEXT", "Needs you");
  slc.children[0].componentPropertyReferences = { characters: t3 };
  place(slc);
  const cd = al("VERTICAL", { paddingTop: 14, paddingBottom: 6, itemSpacing: 4 });
  cd.primaryAxisSizingMode = "AUTO";
  cd.counterAxisSizingMode = "FIXED";
  cd.resize(366, 100);
  cd.fills = [P("surface/raised")];
  cd.strokes = [P("border/default")];
  cd.strokeWeight = 1;
  cd.strokeAlign = "INSIDE";
  cd.cornerRadius = 14;
  cd.clipsContent = true;
  const head = al("VERTICAL", { paddingLeft: 15, paddingRight: 15, paddingBottom: 8, itemSpacing: 2 });
  head.name = "Card head";
  head.appendChild(text("This week", 13.5, 700, "text/heading", { lh: 20.3, name: "Title" }));
  head.appendChild(text("Three things need you", 12, 400, "text/muted", { lh: 16, name: "Detail" }));
  cd.appendChild(head);
  head.layoutSizingHorizontal = "FILL";
  for (let i = 0; i < 2; i++) {
    const r = lrc.createInstance();
    cd.appendChild(r);
    r.layoutSizingHorizontal = "FILL";
  }
  const cdc = comp(cd, "Card", "White card with a title, detail and list rows. Add, remove or swap rows freely.");
  if (shadow) await cdc.setEffectStyleIdAsync(shadow.id);
  const t4 = cdc.addComponentProperty("Title", "TEXT", "This week");
  const t5 = cdc.addComponentProperty("Detail", "TEXT", "Three things need you");
  head.children[0].componentPropertyReferences = { characters: t4 };
  head.children[1].componentPropertyReferences = { characters: t5 };
  place(cdc);
  // Area preview: one header per area mode, to show colours follow the mode
  row();
  Y += 120;
  const prev = figma.createAutoLayout("VERTICAL", {
    name: "Header in every area (instances, mode set per frame)",
    itemSpacing: 16,
  });
  prev.fills = [];
  for (const m of areaC.modes) {
    const f = figma.createAutoLayout("VERTICAL", { name: m.name });
    f.fills = [];
    f.setExplicitVariableModeForCollection(areaC, m.modeId);
    const h = hpc.createInstance();
    f.appendChild(h);
    const p = h.findOne((n) => n.type === "INSTANCE" && n.mainComponent && n.mainComponent.id === mpc.id);
    p.setProperties({ [tp3]: m.name });
    prev.appendChild(f);
  }
  place(prev);
  return { page: page.id, made };
}
