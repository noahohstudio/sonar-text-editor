// Sonar text editor, random: no controls. Every letter added or deleted
// re-rolls the whole look: palette, font, line shape and motion, glob, and how
// many lines there are and where. The roll is seeded by the text itself, so
// deleting a letter brings back the look from before it, and the same words
// always look the same. Runs on top of sketch.js.

// [background, text, glob]
const PALETTES = [
  ['#ffffff', '#000000', '#2f2bff'],
  ['#0c0c0e', '#f2f1ec', '#ff5a1f'],
  ['#1f3cff', '#ffffff', '#9fe7ff'],
  ['#f4f2ee', '#111111', '#ff2e88'],
  ['#efe6d8', '#2a1a12', '#e8451c'],
  ['#e9ff3b', '#111111', '#7a3cff'],
  ['#ff4d2e', '#fff4ea', '#1a1a1a'],
  ['#0e3b2e', '#e7f5e1', '#ffd23f'],
  ['#d9d4ff', '#1b1440', '#ff6b3d'],
  ['#111111', '#c8ff2e', '#ff2e88'],
  ['#f7f7f2', '#1b4dff', '#ff3b30'],
  ['#2b0f3a', '#ffd6f2', '#3cffd0'],
];

// The same text always gives the same numbers (FNV-1a, then mulberry32).
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Leans toward the subtle end: thin reach, mostly Out, few lines.
function roll(text) {
  const r = seeded(text);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const between = (lo, hi) => lo + (hi - lo) * r();

  const [bg, fg, glob] = pick(PALETTES);
  Object.assign(state, {
    bg,
    fg,
    glob,
    line: r() < 0.25 ? glob : null,
    globAmount: r() < 0.7 ? Math.round(between(35, 85)) : 0,
    shape: pick(['line', 'line', 'cross', 'pulse']),
    speed: Math.round(between(15, 90)),
    morph: r() < 0.8 ? Math.round(between(35, 85)) : -Math.round(between(30, 70)),
    reach: Math.round(2 + 7 * r() * r()),
  });
  const lines = 1 + Math.floor(4 * r() * r());
  state.pivots = Array.from({ length: lines }, (_, i) => ({
    x: i ? between(0.1, 0.9) : 0.5,
    y: i ? between(0.15, 0.85) : 0.5,
    angle: r() * TAU,
  }));

  // Fonts that haven't loaded yet are skipped this time and fetched for next.
  const font = Math.floor(r() * FONTS.length);
  if (fonts[font]) state.font = font;
  applyColors();
}

// Fetches every font once, then rolls again so the font matches the text's
// roll from then on.
async function loadAllFonts() {
  await Promise.all(
    FONTS.map(async (f, i) => {
      if (!fonts[i]) fonts[i] = await loadFont(f.url, f.name);
    }),
  );
  roll(state.text);
  buildLayout();
}

const typeText = setText;
setText = (next) => {
  if (next !== state.text) roll(next);
  typeText(next);
};

const startUp = setup;
setup = async () => {
  await startUp();
  loadAllFonts();
  roll(state.text);
  buildLayout();
};
