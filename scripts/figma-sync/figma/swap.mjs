// Figma-runtime script. Serialised into a `use_figma` call by build-calls.mjs (--swap <pageId>); never runs in Node.
// Replaces captured headers and tab bars on one page with instances of the Components page, so a header or
// tab-bar change is made once. Safe to run again: it only touches captured headers and tab bars it still finds.
// `PAGE_ID` is the Figma page id (for example '7:14'), prepended as a constant by build-calls.mjs.
// Keep it free of imports and Node APIs: it must stay valid inside Figma's plugin runtime.
export default async function swap(figma, PAGE_ID) {
  // Swap captured headers and tab bars for component instances on one page. Idempotent.
  const page = await figma.getNodeByIdAsync(PAGE_ID);
  await figma.setCurrentPageAsync(page);
  // Look the page up by name: components.mjs creates it with a fresh id in a new file.
  const comps = figma.root.children.find((p) => p.name === "Components");
  if (!comps) throw new Error("No Components page yet. Run components.js first.");
  await comps.loadAsync();
  const byName = {};
  for (const c of comps.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] })) byName[c.name] = c;
  const HP = byName["Header / Phone"],
    HD = byName["Header / Desktop"],
    MORE = byName["Tab / More"],
    TABSET = byName["Tab"];
  const TSEL = TABSET.children.find((c) => c.name === "State=Selected"),
    TDEF = TABSET.children.find((c) => c.name === "State=Default");
  const MP = byName["Mode pill"],
    AB = byName["Area badge"],
    IB = byName["Icon button"];
  const mpName = Object.keys(MP.componentPropertyDefinitions).find((k) => k.startsWith("Area name"));
  const abIcon = Object.keys(AB.componentPropertyDefinitions).find((k) => k.startsWith("Icon"));
  const ibIcon = Object.keys(IB.componentPropertyDefinitions).find((k) => k.startsWith("Icon"));
  const tLabel = Object.keys(TABSET.componentPropertyDefinitions).find((k) => k.startsWith("Label"));
  const showBack = Object.keys(HD.componentPropertyDefinitions).find((k) => k.startsWith("Show back"));
  for (const st of ["Regular", "SemiBold", "Bold"]) await figma.loadFontAsync({ family: "Geist", style: st });
  let headers = 0,
    tabbars = 0;
  const skipped = [];
  const olds = page.findAll((n) => n.type === "FRAME" && n.name === "edge-glass-header");
  for (const old of olds) {
    const parent = old.parent,
      idx = parent.children.indexOf(old);
    const txt =
      old.findOne((n) => n.type === "TEXT" && n.parent && n.parent.name === "universal-header-mode-area-only") ||
      old.findOne((n) => n.type === "TEXT");
    const badge = old.findOne((n) => n.name === "universal-header-mode-badge");
    const badgeIcon = badge && badge.findOne((n) => n.type === "INSTANCE");
    const icons = old.findAll(
      (n) =>
        (n.type === "INSTANCE" && n.parent === old) ||
        (n.type === "INSTANCE" && n.parent.type === "GROUP" && n.parent.parent === old),
    );
    const left = icons.filter((i) => i.x < 100 && (!badge || i.parent !== badge)).sort((a, b) => a.x - b.x)[0];
    const desktop = old.width > 600;
    const inst = (desktop ? HD : HP).createInstance();
    parent.insertChild(idx, inst);
    inst.x = old.x;
    inst.y = old.y;
    if (Math.abs(inst.width - old.width) > 0.5) inst.resize(old.width, old.height);
    const pill = inst.findOne((n) => n.type === "INSTANCE" && n.mainComponent && n.mainComponent.id === MP.id);
    if (txt) pill.setProperties({ [mpName]: txt.characters });
    const ab = pill.findOne((n) => n.type === "INSTANCE" && n.mainComponent && n.mainComponent.id === AB.id);
    if (badgeIcon && badgeIcon.mainComponent) ab.setProperties({ [abIcon]: badgeIcon.mainComponent.id });
    if (desktop && left) {
      // Sub-pages carry a back button on desktop too: show the header's hidden Back slot.
      if (!showBack) {
        skipped.push(old.id + " desktop header kept: Header / Desktop has no Show back property");
        inst.remove();
        continue;
      }
      inst.setProperties({ [showBack]: true });
    }
    const leftSlot = desktop
      ? inst.findOne((n) => n.name === "Back")
      : inst.children.find((n) => n.type === "INSTANCE" && n.x < 100);
    if (left && left.mainComponent && leftSlot) leftSlot.setProperties({ [ibIcon]: left.mainComponent.id });
    old.remove();
    headers++;
  }
  const bars = page.findAll(
    (n) =>
      n.type === "FRAME" &&
      / pages$/.test(n.name) &&
      n.height > 44 &&
      n.height < 54 &&
      n.parent &&
      n.parent.type === "FRAME" &&
      Math.abs(n.parent.height - 105) < 3,
  );
  for (const old of bars) {
    const spans = old.children.filter((c) => c.type === "FRAME");
    const tabs = spans.filter((s) => s.children.some((q) => q.type === "TEXT"));
    const under = spans.find((s) => !s.children.length && s.height <= 3);
    if (!tabs.length) {
      skipped.push(old.id + " no tabs");
      continue;
    }
    const fr = figma.createAutoLayout("HORIZONTAL", { name: old.name, itemSpacing: 20 });
    fr.fills = [];
    fr.paddingLeft = Math.round(tabs[0].x);
    const parent = old.parent,
      idx = parent.children.indexOf(old);
    parent.insertChild(idx, fr);
    fr.x = old.x;
    fr.y = old.y;
    tabs.forEach((s, i) => {
      const label = s.children.find((q) => q.type === "TEXT").characters;
      const last = i === tabs.length - 1 && old.findOne((q) => q.type === "INSTANCE" && q.x > s.x + s.width - 2);
      if (last) {
        const m = MORE.createInstance();
        fr.appendChild(m);
        const t = m.findOne((q) => q.type === "TEXT");
        t.characters = label;
        return;
      }
      const selected = under && Math.abs(under.x - s.x) < 2;
      const t = (selected ? TSEL : TDEF).createInstance();
      fr.appendChild(t);
      t.setProperties({ [tLabel]: label });
    });
    fr.counterAxisSizingMode = "FIXED";
    fr.resize(fr.width, old.height);
    fr.primaryAxisSizingMode = "FIXED";
    fr.resize(old.width, old.height);
    fr.clipsContent = true;
    old.remove();
    tabbars++;
  }
  return { page: page.name, headers, tabbars, skipped };
}
