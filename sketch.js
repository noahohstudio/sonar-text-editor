// Sonar text editor
// Lines spin around pivots (plot more with the + tool); each starts turning
// when it's placed. Wherever one crosses a letter's outline, the outline gets
// pinched out along it like goo (or pinched in), and the cursor does the same
// when it hovers. The moment the line or the cursor moves on it's back at rest,
// so only the outline under them changes. Goo pulled far enough out of its
// letter can take a second color (Glob).

const fontURL = (id, weight) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-normal.ttf`;

const FONTS = [
  { name: 'Inter', url: fontURL('inter', 600) },
  { name: 'Instrument Serif', url: fontURL('instrument-serif', 400) },
  { name: 'Space Grotesk', url: fontURL('space-grotesk', 500) },
  { name: 'Fraunces', url: fontURL('fraunces', 700) },
  { name: 'Syne', url: fontURL('syne', 700) },
  { name: 'JetBrains Mono', url: fontURL('jetbrains-mono', 500) },
];

const DOCK_KEY = 'Tab'; // keybind is TBD; change it here
const SAMPLE_FACTOR = 0.7; // outline points per px of glyph outline (dense enough for smooth pinches)
const TAU = Math.PI * 2;

const PIVOT_PRESETS = [
  [0, 0], [0.5, 0], [1, 0],
  [0, 0.5], [0.5, 0.5], [1, 0.5],
  [0, 1], [0.5, 1], [1, 1],
];

// Whole looks to start from. They keep the text and its size. Lines are
// [x, y, angle]: staggered angles, as if they'd been placed at different times.
const PRESETS = [
  {
    name: 'Ink', font: 0, bg: '#ffffff', fg: '#000000', line: null, glob: '#2f2bff', globAmount: 0,
    shape: 'line', speed: 45, morph: 50, reach: 4, pivots: [[0.5, 0.5, 0]],
  },
  {
    name: 'Signal', font: 0, bg: '#ffffff', fg: '#0a0a0a', line: '#2f2bff', glob: '#2f2bff', globAmount: 60,
    shape: 'cross', speed: 30, morph: 60, reach: 4, pivots: [[0.5, 0.5, 0.4]],
  },
  {
    name: 'Night', font: 2, bg: '#0c0c0e', fg: '#f2f1ec', line: null, glob: '#ff5a1f', globAmount: 55,
    shape: 'pulse', speed: 60, morph: 55, reach: 5, pivots: [[0.5, 0.5, 0], [0.22, 0.3, 3.1]],
  },
  {
    name: 'Blueprint', font: 5, bg: '#1f3cff', fg: '#ffffff', line: null, glob: '#9fe7ff', globAmount: 45,
    shape: 'line', speed: 20, morph: 40, reach: 3, pivots: [[0.3, 0.5, 0], [0.7, 0.5, 1.9]],
  },
  {
    name: 'Swarm', font: 0, bg: '#f4f2ee', fg: '#111111', line: null, glob: '#ff2e88', globAmount: 70,
    shape: 'line', speed: 40, morph: 50, reach: 4,
    pivots: [[0.2, 0.25, 0.3], [0.45, 0.7, 1.4], [0.62, 0.35, 2.6], [0.85, 0.6, 4.1], [0.5, 0.5, 5.2]],
  },
  {
    name: 'Melt', font: 3, bg: '#efe6d8', fg: '#2a1a12', line: null, glob: '#e8451c', globAmount: 50,
    shape: 'line', speed: 15, morph: 90, reach: 9, pivots: [[0.5, 0.5, 0]],
  },
];

const FRAME = 566 / 337; // shape of the Figma desktop frame; the type is sized against it
const MAX_LINES = 16; // the goo shader has room for this many
const HIT = 18; // px: how close a click has to be to grab or remove a centre

const state = {
  text: 'text here',
  font: 0,
  size: 160, // px, set from sizeRatio by fitSize()
  sizeRatio: 0.113, // type size as a share of frameWidth() (Figma: 64px on a 566px frame)
  tracking: -5, // % of size (Figma's -5%)
  leading: 110, // % of size
  bg: '#ffffff',
  fg: '#000000',
  line: null, // guide color; null = same as the text
  glob: '#2f2bff', // color of goo pulled far out of its letter
  globAmount: 0, // 0 off … 100: how little pulling it takes to change color
  shape: 'line', // line | cross | pulse
  speed: 45, // degrees per second
  morph: 50, // -100 pinch in … +100 pinch out
  reach: 4, // half-width of the line's band, % of size
  showLine: true,
  hover: true, // the cursor pinches too
  pivots: [{ x: 0.5, y: 0.5, angle: 0 }], // one per spinning line: fraction of canvas, current angle
};

const fonts = []; // loaded p5.Font per FONTS index
let glyphCache = { key: '', map: new Map() };

// Outline points, flat. b = rest position, n = outward normal, d = displacement.
let pts = { n: 0, bx: null, by: null, nx: null, ny: null, dx: null, dy: null };
let contours = []; // [start, end) index pairs into pts
let caret = { x: 0, y: 0, asc: 0, desc: 0 };

let layoutVersion = 0; // bumps whenever the rest outlines change
let clock = 0; // seconds
let draggingPivot = false;
let active = 0; // the pivot a preset spot moves: the last one placed or dragged
let tool = null; // null | 'add' | 'remove': what a click on the canvas does to lines
let pointer = null; // cursor over the canvas, CSS px
let recording = null;
const syncs = []; // each puts a piece of state back on its control

// ---------------------------------------------------------------- p5

async function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.elt.addEventListener('pointerdown', onCanvasPointer);
  fitSize();
  applyColors();

  fonts[0] = await loadFont(FONTS[0].url, FONTS[0].name);
  buildDock();
  buildLayout();
  typeInput().value = state.text;
  if (matchMedia('(pointer: coarse)').matches) {
    select('#hint').html('Tap the text to type · tap the handle for controls');
  }
  setTimeout(() => select('#hint').addClass('gone'), 5000);
}

function draw() {
  const dt = Math.min(deltaTime / 1000, 0.05);
  clock += dt;
  // Each line keeps its own angle, so it turns from wherever it was placed.
  const turn = radians(state.speed) * dt;
  for (const p of state.pivots) p.angle = (p.angle + turn) % TAU;
  deform();
  paint(false);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  fitSize();
  syncDock();
  buildLayout();
}

// Width of the biggest Figma-shaped frame that fits in the window. On a wide,
// short window it's the height that limits it.
function frameWidth() {
  return Math.min(width, height * FRAME);
}

// The type keeps the same share of that frame, so it follows the window both
// ways. The slider's range is the limit; hitting it doesn't change the share.
function fitSize() {
  const slider = document.getElementById('size');
  state.size = Math.round(constrain(frameWidth() * state.sizeRatio, Number(slider.min), Number(slider.max)));
}

// ---------------------------------------------------------------- layout

function glyphFor(ch, font) {
  const key = `${state.font}|${state.size}`;
  if (glyphCache.key !== key) glyphCache = { key, map: new Map() };
  let g = glyphCache.map.get(ch);
  if (!g) {
    g = {
      contours: ch.trim() ? withNormals(font.textToContours(ch, 0, 0, { sampleFactor: SAMPLE_FACTOR })) : [],
      advance: fontWidth(ch), // p5 2.x textWidth() is ink bounds, so a space measures 0
    };
    glyphCache.map.set(ch, g);
  }
  return g;
}

// Gives every outline point a unit normal pointing away from the ink: out of a
// stem, into a counter. That's the direction a stroke swells when it bubbles.
function withNormals(raw) {
  const contours = raw.filter((c) => c.length >= 3);
  const area = (c) =>
    c.reduce((sum, p, i) => {
      const q = c[(i + 1) % c.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0);

  // The biggest contour is an outer edge. Counters wind the other way, so the
  // outer edge's winding gives one rule that works for both.
  let biggest = 0;
  let sign = 1;
  for (const c of contours) {
    const a = area(c);
    if (Math.abs(a) > biggest) {
      biggest = Math.abs(a);
      sign = Math.sign(a) || 1;
    }
  }

  return contours.map((c) =>
    c.map((p, i) => {
      const a = c[(i - 1 + c.length) % c.length];
      const b = c[(i + 1) % c.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x, y: p.y, nx: (sign * (b.y - a.y)) / len, ny: (-sign * (b.x - a.x)) / len };
    }),
  );
}

function buildLayout() {
  const font = fonts[state.font];
  if (!font) return;

  textFont(font);
  textSize(state.size);
  textAlign(LEFT, BASELINE);

  const track = (state.size * state.tracking) / 100;
  const lineHeight = (state.size * state.leading) / 100;
  const asc = textAscent();
  const desc = textDescent();
  const lines = state.text.split('\n');

  const xs = [];
  const ys = [];
  const nxs = [];
  const nys = [];
  const ranges = [];
  let baseline = height / 2 - ((lines.length - 1) * lineHeight) / 2 + (asc - desc) / 2;
  let x = width / 2;

  for (const line of lines) {
    const chars = Array.from(line);
    const glyphs = chars.map((ch) => glyphFor(ch, font));
    const lineWidth =
      glyphs.reduce((sum, g) => sum + g.advance, 0) + track * Math.max(0, chars.length - 1);
    x = width / 2 - lineWidth / 2;

    for (const g of glyphs) {
      for (const contour of g.contours) {
        const start = xs.length;
        for (const p of contour) {
          xs.push(x + p.x);
          ys.push(baseline + p.y);
          nxs.push(p.nx);
          nys.push(p.ny);
        }
        ranges.push([start, xs.length]);
      }
      x += g.advance + track;
    }
    if (chars.length) x -= track;
    caret = { x, y: baseline, asc, desc };
    baseline += lineHeight;
  }

  const n = xs.length;
  pts = {
    n,
    bx: Float32Array.from(xs),
    by: Float32Array.from(ys),
    nx: Float32Array.from(nxs),
    ny: Float32Array.from(nys),
    dx: new Float32Array(n),
    dy: new Float32Array(n),
  };
  contours = ranges;
  layoutVersion++;
}

// ---------------------------------------------------------------- motion

// Every spinning line right now: pivot (CSS px), angle, and its pulse ring.
function spinners() {
  const band = bandPx();
  return state.pivots.map((p) => {
    const x = p.x * width;
    const y = p.y * height;
    const a = p.angle;
    return { x, y, a, ring: pulseRadius(x, y, a, band) };
  });
}

// Half-width of the line's band, CSS px.
function bandPx() {
  return Math.max(1.5, (state.size * state.reach) / 100);
}

// How far the cursor's pull reaches, CSS px.
function hoverRadius() {
  return state.size * 0.08 + bandPx() * 2;
}

function pulseRadius(x, y, a, band) {
  const far = Math.max(
    Math.hypot(x, y),
    Math.hypot(width - x, y),
    Math.hypot(x, height - y),
    Math.hypot(width - x, height - y),
  );
  // One ring per revolution, starting just inside the pivot and leaving the screen.
  return (a / TAU) * (far + band * 3) - band;
}

// 1 on the line, tapering to exactly 0 at the edge of its band. The long concave
// flanks give the pinch a gooey neck and a rounded tip.
function profile(u) {
  const q = 1 - u * u;
  return q > 0 ? q * q * q : 0;
}

// Bends each node by where the lines (and the cursor) are right now. No springs
// or memory, so a letter is only ever out of shape while something is on it.
function deform() {
  const { n, bx, by, nx, ny, dx, dy } = pts;
  if (!n) return;

  const band = bandPx();
  const pinch = state.size * 0.3 * (state.morph / 100); // how far a pinch reaches; < 0 cuts in
  const grain = 1.5 / state.size; // noise scale: varies from one crossing to the next
  const t = clock * 0.4;
  const shape = state.shape;
  const lines = spinners().map((s) => ({
    ...s,
    dirs: (shape === 'cross' ? [s.a, s.a + Math.PI / 2] : [s.a]).map((a) => ({
      nx: -Math.sin(a),
      ny: Math.cos(a),
      ux: Math.cos(a),
      uy: Math.sin(a),
    })),
  }));
  const hover = state.hover && pointer ? { ...pointer, r: hoverRadius() } : null;

  // Only nodes inside a band move. Everything else sits at rest.
  for (let i = 0; i < n; i++) {
    let f = 0; // 1 on the line, 0 outside the band
    let ux = 0; // direction of the line at this node
    let uy = 0;
    let toCursor = 0; // distance to the cursor, when the cursor is what's pulling

    for (const s of lines) {
      const x = bx[i] - s.x;
      const y = by[i] - s.y;
      if (shape === 'line' || shape === 'cross') {
        for (const l of s.dirs) {
          const w = profile((x * l.nx + y * l.ny) / band);
          if (w > f) {
            f = w;
            ux = l.ux;
            uy = l.uy;
          }
        }
        continue;
      }
      // Pulse: the band is a ring growing out of the pivot.
      const rho = Math.hypot(x, y);
      if (rho <= 1) continue;
      const w = profile((rho - s.ring) / band);
      if (w > f) {
        f = w;
        ux = -y / rho;
        uy = x / rho;
      }
    }

    // The cursor pulls toward itself, like goo following a fingertip.
    if (hover) {
      const x = hover.x - bx[i];
      const y = hover.y - by[i];
      const dist = Math.hypot(x, y);
      const w = dist > 0.5 ? profile(dist / hover.r) : 0;
      if (w > f) {
        f = w;
        ux = x / dist;
        uy = y / dist;
        toCursor = dist;
      }
    }

    if (f === 0) {
      dx[i] = 0;
      dy[i] = 0;
      continue;
    }

    // Pinch: drag the outline along the line, out of the ink. An edge the line
    // cuts squarely pulls out furthest. Cubing keeps edges the line only skims
    // from smearing along it. Noise only changes how far each pinch reaches
    // (about 0.5–1.3×), never its shape; p5 noise mostly sits around 0.3–0.7.
    let out = nx[i] * ux + ny[i] * uy;
    if (toCursor) out = Math.max(0, out); // only edges facing the cursor reach for it
    const reach = constrain(0.6 + (noise(bx[i] * grain, by[i] * grain, t) - 0.3) * 1.75, 0.5, 1.3);
    let m = pinch * f * out * out * out * reach;
    if (toCursor) m = Math.min(m, toCursor * 0.85); // never past the cursor
    dx[i] = ux * m;
    dy[i] = uy * m;
  }
}

// ---------------------------------------------------------------- drawing

function hexRGB(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgba(hex, a) {
  return `rgba(${hexRGB(hex).join(', ')}, ${a})`;
}

const lineColor = () => state.line ?? state.fg;

// The (pinched) outlines as one path, or the font at rest.
function typePath(rest = false) {
  const path = new Path2D();
  const { bx, by } = pts;
  const dx = rest ? new Float32Array(pts.n) : pts.dx;
  const dy = rest ? dx : pts.dy;
  for (const [a, b] of contours) {
    path.moveTo(bx[a] + dx[a], by[a] + dy[a]);
    for (let i = a + 1; i < b; i++) path.lineTo(bx[i] + dx[i], by[i] + dy[i]);
    path.closePath();
  }
  return path;
}

function paint(clean) {
  const ctx = drawingContext;
  background(state.bg);

  const path = typePath();
  if (state.morph !== 0 && goo.render(path)) {
    ctx.drawImage(goo.canvas, 0, 0, width, height);
  } else {
    ctx.fillStyle = state.fg;
    ctx.fill(path, 'nonzero');
  }

  if (state.showLine) paintGuide(ctx);

  if (clean || recording) return;

  // Caret (never exported).
  if (millis() % 1060 < 600) {
    ctx.fillStyle = state.fg;
    const w = Math.max(2, state.size * 0.018);
    ctx.fillRect(caret.x + state.size * 0.05, caret.y - caret.asc * 0.82, w, caret.asc * 0.82 + caret.desc * 0.4);
  }

  // Centre markers. All of them while the controls are open, a line tool is on
  // or a centre is being dragged; otherwise just one the cursor is near, so
  // there's something to grab.
  const showAll = document.body.classList.contains('dock-open') || draggingPivot || tool;
  const doomed = tool === 'remove' && pointer ? pivotAt(pointer.x, pointer.y) : -1;
  const marker = (x, y, alpha, weight) => {
    ctx.strokeStyle = rgba(state.fg, alpha);
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y + 16);
    ctx.stroke();
  };
  state.pivots.forEach((p, i) => {
    const x = p.x * width;
    const y = p.y * height;
    if (!showAll && !(pointer && Math.hypot(pointer.x - x, pointer.y - y) < 48)) return;
    marker(x, y, i === doomed ? 1 : 0.55, i === doomed ? 2 : 1);
    if (i === active && state.pivots.length > 1 && !tool) {
      ctx.fillStyle = rgba(state.fg, 0.55);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TAU);
      ctx.fill();
    }
  });
  // Where the next line would go.
  if (tool === 'add' && pointer && state.pivots.length < MAX_LINES) marker(pointer.x, pointer.y, 0.3, 1);
}

function paintGuide(ctx) {
  const L = Math.hypot(width, height) * 2;
  ctx.save();
  ctx.strokeStyle = lineColor();
  ctx.lineWidth = 1.25;

  for (const s of spinners()) {
    if (state.shape === 'pulse') {
      if (s.ring > 0) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.ring, 0, TAU);
        ctx.stroke();
      }
    } else {
      const angles = state.shape === 'cross' ? [s.a, s.a + Math.PI / 2] : [s.a];
      ctx.beginPath();
      for (const a of angles) {
        ctx.moveTo(s.x - Math.cos(a) * L, s.y - Math.sin(a) * L);
        ctx.lineTo(s.x + Math.cos(a) * L, s.y + Math.sin(a) * L);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- goo
// The wet look. The outlines are drawn as a coverage mask, blurred on the GPU
// and cut again at half coverage, but only near the line. There, corners round
// off, close shapes grow bridges and spill into each other, and the line itself
// is a little sticky, so letters string along it. Away from the line the mask
// is used as is, so letters the line isn't on stay exactly the font.

// How wet things are for the current settings. Lengths in CSS px. Everything
// scales with the band, so a thin band gives thin, precise, wet needles.
function gooParams() {
  const k = state.morph / 100;
  const band = bandPx();
  // Blur radius. Capped against the type size so a wide band doesn't melt words.
  const sigma = Math.max(1, Math.min(band * 0.6 + state.size * 0.006, state.size * 0.04)) * (0.5 + Math.abs(k));
  return {
    band,
    zone: band + sigma * 2.5, // how far from the line the goo reaches
    sigma,
    thread: k > 0 ? 0.42 * k : 1.1 * k, // the line's own pull; < 0 cuts a groove
    threadWidth: Math.max(1, Math.min(band * 0.6, state.size * 0.03)),
    hoverZone: hoverRadius() + sigma * 2.5,
    // Glob: how far out of its letter ink has to be pulled before it changes
    // color, from 0 (right at the outline) to 1 (about 0.08 × size out). > 1 is off.
    globAt: state.globAmount > 0 ? 0.95 - 0.8 * (state.globAmount / 100) : 2,
    restSigma: state.size * 0.04, // how blurry the font at rest is when measuring that
  };
}

const GOO_VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

// One direction of a gaussian blur over the coverage.
const GOO_BLUR = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 size;   // output px
uniform vec2 dir;    // one output px along the blur, in uv
uniform float sigma; // output px
out vec4 color;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  int r = int(ceil(sigma * 3.0));
  float sum = 0.0;
  float total = 0.0;
  for (int i = -r; i <= r; i++) {
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    sum += texture(src, uv + dir * float(i)).a * w;
    total += w;
  }
  color = vec4(sum / total);
}`;

// Blends crisp and blurred coverage by closeness to the line, adds the line's
// stickiness, then cuts at 0.5 with a one-pixel soft edge. Ink that has been
// pulled far enough out of its letter shades into the glob color.
const GOO_FINAL = `#version 300 es
precision highp float;
uniform sampler2D ink;
uniform sampler2D soft;
uniform sampler2D rest;  // the font at rest, blurred: low where ink has left its letter
uniform float globAt;    // how far out (0–1) ink turns the glob color; > 1 = never
uniform vec3 globColor;
uniform vec2 size;       // device px
uniform float density;
uniform vec4 spin[${MAX_LINES}];   // per line: pivot x, y (CSS px), angle, pulse ring
uniform int spinCount;
uniform vec3 hover;      // cursor x, y (CSS px) and how far its goo reaches; 0 = off
uniform int shape;       // 0 line, 1 cross, 2 pulse
uniform float band;
uniform float thread;
uniform float threadWidth;
uniform vec3 fg;
out vec4 color;

const float TAU = 6.2831853;

float across(vec2 p, float a) { return abs(-p.x * sin(a) + p.y * cos(a)); }

// Same distances deform() uses, so the goo sits exactly where the pinch does.
float lineDistance(vec2 q, vec4 s) {
  vec2 p = q - s.xy;
  if (shape == 0) return across(p, s.z);
  if (shape == 1) return min(across(p, s.z), across(p, s.z + TAU / 4.0));
  return abs(length(p) - s.w);
}

void main() {
  vec2 uv = gl_FragCoord.xy / size;
  vec2 q = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y) / density;
  float crisp = texture(ink, uv).a;
  float d = 1e6;
  for (int i = 0; i < ${MAX_LINES}; i++) {
    if (i >= spinCount) break;
    d = min(d, lineDistance(q, spin[i]));
  }
  float u = min(d / band, 1.0);
  float m = (1.0 - u * u) * (1.0 - u * u);
  float stick = exp(-d * d / (2.0 * threadWidth * threadWidth));
  if (hover.z > 0.0) {
    float h = length(q - hover.xy);
    float v = min(h / hover.z, 1.0);
    m = max(m, (1.0 - v * v) * (1.0 - v * v));
    stick = max(stick, exp(-h * h / (2.0 * threadWidth * threadWidth)));
  }
  float f = mix(crisp, texture(soft, uv).a, m) + thread * m * stick;
  float wet = clamp((f - 0.5) / max(fwidth(f), 1e-3) + 0.5, 0.0, 1.0);
  float a = m > 0.0 ? wet : crisp;
  // Only where a line or the cursor is, so untouched letters keep their color.
  float away = clamp(1.0 - 2.0 * texture(rest, uv).a, 0.0, 1.0);
  float glob = smoothstep(globAt, globAt + 0.12, away) * smoothstep(0.0, 0.15, m);
  color = vec4(mix(fg, globColor, glob) * a, a);
}`;

function createGoo() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { canvas, render: () => false }; // falls back to plain outlines

  const ink = document.createElement('canvas');
  const inkCtx = ink.getContext('2d');

  const program = (frag) => {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, GOO_VERT], [gl.FRAGMENT_SHADER, frag]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(prog, s);
    }
    gl.bindAttribLocation(prog, 0, 'pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
      const { name } = gl.getActiveUniform(prog, i);
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, u };
  };
  const blur = program(GOO_BLUR);
  const final = program(GOO_FINAL);

  // One triangle that covers the viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const inkTex = texture();
  const target = () => ({ tex: texture(), fb: gl.createFramebuffer() });
  const passes = [target(), target()];
  const rest = { ...target(), key: '' }; // the font at rest, blurred; redone only when the layout changes
  let sized = '';

  return {
    canvas,

    // Renders the type through the goo into this.canvas. False if it can't.
    render(path) {
      const pd = pixelDensity();
      const W = Math.round(width * pd);
      const H = Math.round(height * pd);
      const g = gooParams();
      // The blur runs at one CSS px, or coarser for big radii so it stays cheap.
      const step = Math.max(1, Math.ceil(g.sigma / 10));
      const w = Math.ceil(width / step);
      const h = Math.ceil(height / step);

      if (sized !== `${W}x${H}/${w}x${h}`) {
        sized = `${W}x${H}/${w}x${h}`;
        canvas.width = ink.width = W;
        canvas.height = ink.height = H;
        for (const pass of [...passes, rest]) {
          gl.bindTexture(gl.TEXTURE_2D, pass.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, pass.fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pass.tex, 0);
        }
      }

      // Coverage of a path, into inkTex.
      const upload = (p) => {
        inkCtx.setTransform(1, 0, 0, 1, 0, 0);
        inkCtx.clearRect(0, 0, W, H);
        inkCtx.setTransform(pd, 0, 0, pd, 0, 0);
        inkCtx.fillStyle = '#fff';
        inkCtx.fill(p, 'nonzero');
        gl.bindTexture(gl.TEXTURE_2D, inkTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ink);
      };

      // Blurs inkTex across, then down, into out.
      const blurInto = (out, sigma) => {
        gl.useProgram(blur.prog);
        gl.uniform1i(blur.u.src, 0);
        gl.uniform2f(blur.u.size, w, h);
        gl.uniform1f(blur.u.sigma, Math.max(0.5, sigma / step));
        gl.viewport(0, 0, w, h);
        gl.activeTexture(gl.TEXTURE0);
        [[inkTex, passes[0], 1 / w, 0], [passes[0].tex, out, 0, 1 / h]].forEach(([src, dst, dx, dy]) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
          gl.bindTexture(gl.TEXTURE_2D, src);
          gl.uniform2f(blur.u.dir, dx, dy);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        });
      };

      const globOn = g.globAt <= 1;
      if (globOn && rest.key !== `${sized}/${layoutVersion}`) {
        rest.key = `${sized}/${layoutVersion}`;
        upload(typePath(true));
        blurInto(rest, g.restSigma);
      }
      upload(path); // the (pinched) outlines
      blurInto(passes[1], g.sigma);

      // Mix, cut and color.
      const lines = spinners().slice(0, MAX_LINES);
      const spin = new Float32Array(MAX_LINES * 4);
      lines.forEach((s, i) => spin.set([s.x, s.y, s.a, s.ring], i * 4));
      gl.useProgram(final.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inkTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, passes[1].tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, rest.tex);
      gl.uniform1i(final.u.ink, 0);
      gl.uniform1i(final.u.soft, 1);
      gl.uniform1i(final.u.rest, 2);
      gl.uniform1f(final.u.globAt, globOn ? g.globAt : 2);
      gl.uniform3f(final.u.globColor, ...hexRGB(state.glob).map((v) => v / 255));
      gl.uniform2f(final.u.size, W, H);
      gl.uniform1f(final.u.density, pd);
      gl.uniform4fv(final.u['spin[0]'], spin);
      gl.uniform1i(final.u.spinCount, lines.length);
      gl.uniform3f(final.u.hover, pointer?.x ?? 0, pointer?.y ?? 0, state.hover && pointer ? g.hoverZone : 0);
      gl.uniform1i(final.u.shape, ['line', 'cross', 'pulse'].indexOf(state.shape));
      gl.uniform1f(final.u.band, g.zone);
      gl.uniform1f(final.u.thread, g.thread);
      gl.uniform1f(final.u.threadWidth, g.threadWidth);
      gl.uniform3f(final.u.fg, ...hexRGB(state.fg).map((v) => v / 255));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      return true;
    },

    // Coverage of the last render, top row first. With glob on, also the part
    // that's mostly glob color (null when it's off or the two colors match).
    read() {
      const W = canvas.width;
      const H = canvas.height;
      const px = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // The channel where the text and glob colors differ most tells them apart.
      const fg = hexRGB(state.fg);
      const gc = hexRGB(state.glob);
      const k = [0, 1, 2].reduce((best, i) => (Math.abs(gc[i] - fg[i]) > Math.abs(gc[best] - fg[best]) ? i : best), 0);
      const span = gc[k] - fg[k];
      const glob = gooParams().globAt <= 1 && Math.abs(span) > 8 ? new Uint8Array(W * H) : null;
      const alpha = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const row = (H - 1 - y) * W;
        for (let x = 0; x < W; x++) {
          const i = (row + x) * 4;
          const a = px[i + 3];
          alpha[y * W + x] = a;
          if (glob && a) {
            const t = ((px[i + k] * 255) / a - fg[k]) / span; // un-premultiplied, 0 = text … 1 = glob
            glob[y * W + x] = Math.min(a, Math.max(0, Math.round(t * 255)));
          }
        }
      }
      return { alpha, glob, W, H };
    },
  };
}

const goo = createGoo();

// Traces where coverage crosses half (marching squares) into SVG path data, so
// the goo exports as real outlines. Grid points are device pixel centers.
function traceOutlines(alpha, W, H, density) {
  const iso = 127.5;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : alpha[y * W + x]);
  const edge = (x, y, vertical) => ((y + 1) * (W + 2) + (x + 1)) * 2 + vertical;
  const next = new Map(); // edge → following edge, walking with the ink on the left
  const point = new Map(); // edge → where the contour crosses it

  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const a = at(x, y); // top left, then clockwise
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      const cell = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
      if (cell === 0 || cell === 15) continue;

      const t = (v0, v1) => (iso - v0) / (v1 - v0);
      const T = () => { const k = edge(x, y, 0); point.set(k, [x + t(a, b), y]); return k; };
      const R = () => { const k = edge(x + 1, y, 1); point.set(k, [x + 1, y + t(b, c)]); return k; };
      const B = () => { const k = edge(x, y + 1, 0); point.set(k, [x + t(d, c), y + 1]); return k; };
      const L = () => { const k = edge(x, y, 1); point.set(k, [x, y + t(a, d)]); return k; };
      const seg = (from, to) => next.set(from(), to());
      const joined = (a + b + c + d) / 4 > iso; // saddles: does the ink connect through the middle?

      switch (cell) {
        case 1: seg(B, L); break;
        case 2: seg(R, B); break;
        case 3: seg(R, L); break;
        case 4: seg(T, R); break;
        case 5: if (joined) { seg(T, L); seg(B, R); } else { seg(T, R); seg(B, L); } break;
        case 6: seg(T, B); break;
        case 7: seg(T, L); break;
        case 8: seg(L, T); break;
        case 9: seg(B, T); break;
        case 10: if (joined) { seg(R, T); seg(L, B); } else { seg(L, T); seg(R, B); } break;
        case 11: seg(R, T); break;
        case 12: seg(L, R); break;
        case 13: seg(B, R); break;
        case 14: seg(L, B); break;
      }
    }
  }

  const f = (v) => +((v + 0.5) / density).toFixed(2);
  let d = '';
  for (const start of next.keys()) {
    if (!point.has(start)) continue; // already walked
    const loop = [];
    for (let k = start; point.has(k); k = next.get(k)) {
      loop.push(point.get(k));
      point.delete(k);
    }
    if (loop.length < 3) continue;
    const kept = simplifyLoop(loop, 0.35);
    d += 'M' + kept.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
  }
  return d;
}

// Drops points that sit within tol of the line through their neighbors
// (Ramer–Douglas–Peucker), keeping a closed loop closed.
function simplifyLoop(pts, tol) {
  let far = 0;
  for (let i = 1, best = 0; i < pts.length; i++) {
    const dist = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (dist > best) {
      best = dist;
      far = i;
    }
  }
  const ring = [...pts, pts[0]];
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[far] = keep[ring.length - 1] = 1;
  const stack = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = ring[s];
    const dx = ring[e][0] - x1;
    const dy = ring[e][1] - y1;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const dist = Math.abs((ring[i][0] - x1) * dy - (ring[i][1] - y1) * dx) / len;
      if (dist > worst) {
        worst = dist;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return ring.slice(0, -1).filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------- export

function stamp() {
  return 'sonar-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportPNG() {
  paint(true); // toBlob snapshots the canvas right away, before the next frame
  drawingContext.canvas.toBlob((blob) => downloadBlob(blob, stamp() + '.png'), 'image/png');
}

function exportSVG() {
  const f = (v) => +v.toFixed(2);
  let d = '';
  let globD = '';
  let rule = 'nonzero';
  if (state.morph !== 0 && goo.render(typePath())) {
    // The goo only exists as pixels, so trace its edge back into outlines. The
    // glob shading becomes a flat second layer, cut where it's half glob color.
    const { alpha, glob, W, H } = goo.read();
    d = traceOutlines(alpha, W, H, pixelDensity());
    if (glob) globD = traceOutlines(glob, W, H, pixelDensity());
    rule = 'evenodd';
  } else {
    const { bx, by, dx, dy } = pts;
    for (const [a, b] of contours) {
      d += `M${f(bx[a] + dx[a])} ${f(by[a] + dy[a])}`;
      for (let i = a + 1; i < b; i++) d += `L${f(bx[i] + dx[i])} ${f(by[i] + dy[i])}`;
      d += 'Z';
    }
  }

  let guide = '';
  if (state.showLine) {
    const L = Math.hypot(width, height) * 2;
    const stroke = `stroke="${lineColor()}" stroke-width="1.25" fill="none"`;
    for (const s of spinners()) {
      if (state.shape === 'pulse') {
        if (s.ring > 0) guide += `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="${f(s.ring)}" ${stroke}/>`;
      } else {
        const angles = state.shape === 'cross' ? [s.a, s.a + Math.PI / 2] : [s.a];
        for (const a of angles) {
          guide += `<line x1="${f(s.x - Math.cos(a) * L)}" y1="${f(s.y - Math.sin(a) * L)}" x2="${f(s.x + Math.cos(a) * L)}" y2="${f(s.y + Math.sin(a) * L)}" ${stroke}/>`;
        }
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${state.bg}"/>` +
    `<path d="${d}" fill="${state.fg}" fill-rule="${rule}"/>` +
    (globD ? `<path d="${globD}" fill="${state.glob}" fill-rule="evenodd"/>` : '') +
    `${guide}</svg>`;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), stamp() + '.svg');
}

function exportVideo(button) {
  if (recording) return;
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  if (!type) return;

  // One full turn of the line (or 4 s if it's stopped), capped at 20 s.
  const seconds = state.speed > 0 ? constrain(360 / state.speed, 2, 20) : 4;
  const stream = drawingContext.canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
    downloadBlob(new Blob(chunks, { type }), `${stamp()}.${ext}`);
    recording = null;
    button.textContent = 'Video';
    button.classList.remove('busy');
  };

  recording = rec;
  rec.start();
  button.classList.add('busy');
  const started = performance.now();
  const tick = () => {
    if (recording !== rec) return;
    const left = seconds - (performance.now() - started) / 1000;
    if (left <= 0) return rec.stop();
    button.textContent = `Rec ${left.toFixed(1)}s`;
    requestAnimationFrame(tick);
  };
  tick();
}

// ---------------------------------------------------------------- text input

function isEditingField(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && ['text', 'number', 'search'].includes(el.type);
}

function setText(next) {
  state.text = next;
  if (typeInput().value !== next) typeInput().value = next;
  buildLayout();
  select('#hint').addClass('gone');
}

// A hidden textarea that mirrors the text, so a touch screen has something to
// bring the keyboard up for. With a real keyboard, keydown below does the typing.
const typeInput = () => document.getElementById('type-input');
typeInput().addEventListener('input', () => setText(typeInput().value));

window.addEventListener('keydown', (e) => {
  if (e.key === DOCK_KEY) {
    e.preventDefault();
    dock.toggle();
    return;
  }
  if (e.key === 'Escape') return tool ? setTool(null) : dock.close();
  if (isEditingField(document.activeElement)) return;

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    return exportPNG();
  }
  if (mod) return; // leave copy / paste / reload alone

  const chars = Array.from(state.text);
  if (e.key === 'Backspace') {
    if (e.altKey) setText(state.text.replace(/\S*\s*$/, ''));
    else setText(chars.slice(0, -1).join(''));
  } else if (e.key === 'Enter') {
    setText(state.text + '\n');
  } else if (e.key.length === 1) {
    setText(state.text + e.key);
  } else {
    return;
  }
  e.preventDefault();
});

window.addEventListener('paste', (e) => {
  if (isEditingField(document.activeElement)) return;
  const pasted = e.clipboardData.getData('text');
  if (pasted) setText(state.text + pasted.replace(/\r\n?/g, '\n'));
  e.preventDefault();
});

// ---------------------------------------------------------------- lines
// Every spinning line has a centre, and the Lines tools decide what a click
// does. With + on, each click places a new line, which starts turning right
// away. With − on, clicking a centre removes its line. With neither, you can
// drag a centre to move it. The preset spots follow the same tool.

// Index of the centre within HIT px of (x, y), or -1.
function pivotAt(x, y) {
  let found = -1;
  let best = HIT;
  state.pivots.forEach((p, i) => {
    const d = Math.hypot(p.x * width - x, p.y * height - y);
    if (d < best) {
      best = d;
      found = i;
    }
  });
  return found;
}

function addPivot(x, y) {
  if (state.pivots.length >= MAX_LINES) return showToolHint(`${MAX_LINES} lines is the most`);
  state.pivots.push({ x: x / width, y: y / height, angle: 0 });
  active = state.pivots.length - 1;
  syncPivotGrid();
}

function removePivot(i) {
  state.pivots.splice(i, 1);
  if (active > i || active >= state.pivots.length) active = Math.max(0, active - 1);
  if (!state.pivots.length) setTool(null); // nothing left to remove
  syncPivotGrid();
}

const TOOL_HINTS = {
  add: 'Click to place a line · Esc when done',
  remove: 'Click a centre to remove its line · Esc when done',
};

function setTool(next) {
  tool = next;
  document.body.dataset.tool = tool ?? '';
  document.getElementById('tool-add').setAttribute('aria-pressed', tool === 'add');
  document.getElementById('tool-remove').setAttribute('aria-pressed', tool === 'remove');
  showToolHint(TOOL_HINTS[tool] ?? '');
}

function showToolHint(text) {
  const hint = document.getElementById('tool-hint');
  hint.textContent = text;
  hint.classList.toggle('on', Boolean(text));
}

function onCanvasPointer(e) {
  if (e.button !== 0) return;
  const hit = pivotAt(e.clientX, e.clientY);
  if (tool === 'add') return addPivot(e.clientX, e.clientY);
  if (tool === 'remove') return hit >= 0 && removePivot(hit);
  if (hit < 0) {
    // On a touch screen, tapping the canvas puts the controls away and types.
    if (e.pointerType !== 'mouse') {
      dock.close();
      typeInput().focus({ preventScroll: true });
    }
    return;
  }

  // Grabbing a centre keeps it under the same spot of the cursor.
  active = hit;
  const p = state.pivots[hit];
  const ox = p.x * width - e.clientX;
  const oy = p.y * height - e.clientY;
  draggingPivot = true;
  const move = (ev) => {
    p.x = constrain((ev.clientX + ox) / width, 0, 1);
    p.y = constrain((ev.clientY + oy) / height, 0, 1);
    syncPivotGrid();
  };
  const up = () => {
    draggingPivot = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Back to one line through the centre, at its starting angle.
function resetLines() {
  state.pivots = [{ x: 0.5, y: 0.5, angle: 0 }];
  active = 0;
  setTool(null);
  syncPivotGrid();
}

// Lines whose centre sits on preset spot (x, y).
const pivotsOn = (x, y) => state.pivots.filter((p) => Math.abs(p.x - x) < 0.001 && Math.abs(p.y - y) < 0.001);

// A dot on every spot that has a line; a ring on the one a spot click moves.
function syncPivotGrid() {
  const p = state.pivots[active];
  for (const btn of document.querySelectorAll('#pivot button')) {
    const [x, y] = btn.dataset.xy.split(',').map(Number);
    const here = pivotsOn(x, y);
    btn.classList.toggle('taken', here.length > 0);
    btn.setAttribute('aria-pressed', here.includes(p));
  }
  document.getElementById('line-count').textContent = state.pivots.length;
}

// ---------------------------------------------------------------- dock

const dock = {
  pinned: false,
  hovering: false,
  closeTimer: 0,
  set(open) {
    document.body.classList.toggle('dock-open', open);
    if (open) select('#hint').addClass('gone');
  },
  update() {
    clearTimeout(this.closeTimer);
    if (this.pinned || this.hovering) return this.set(true);
    this.closeTimer = setTimeout(() => this.set(false), 250);
  },
  toggle() {
    this.pinned = !document.body.classList.contains('dock-open');
    if (!this.pinned) this.hovering = false;
    this.update();
  },
  close() {
    this.pinned = false;
    this.hovering = false;
    this.update();
  },
};

window.addEventListener('pointermove', (e) => {
  pointer = e.target.tagName === 'CANVAS' ? { x: e.clientX, y: e.clientY } : null;
  if (e.pointerType !== 'mouse') return; // touch opens the controls with the handle
  const overDock = e.target.closest && e.target.closest('.bar');
  dock.hovering = Boolean(overDock) || e.clientY > window.innerHeight - 56;
  if (!draggingPivot) dock.update();
});
// A finger pinches like the cursor, but only while it's down.
window.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') pointer = null;
});
document.getElementById('handle').addEventListener('click', () => dock.toggle());
document.addEventListener('pointerleave', () => {
  dock.hovering = false;
  pointer = null;
  dock.update();
});

// Puts the whole state back on the controls, after a resize or a preset.
function syncDock() {
  for (const sync of syncs) sync();
}

// The page and the controls take on the background. The controls are tinted
// glass, so their ink flips to light on a dark background.
function applyColors() {
  const [r, g, b] = hexRGB(state.bg);
  document.body.style.background = state.bg;
  document.body.style.setProperty('--bg', state.bg);
  document.body.dataset.tone = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55 ? 'dark' : 'light';
}

// Wires a slider to state[key].
function bindRange(id, key, format) {
  const input = document.getElementById(id);
  const out = document.querySelector(`output[for="${id}"]`);
  const show = () => {
    input.value = state[key];
    out.textContent = format(state[key]);
  };
  show();
  syncs.push(show);
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    out.textContent = format(state[key]);
    if (key === 'size') state.sizeRatio = state.size / frameWidth();
    if (['size', 'tracking', 'leading'].includes(key)) buildLayout();
  });
}

// Applies a whole look. The text, its size and Hover stay as they are.
async function applyPreset(index) {
  const p = PRESETS[index];
  for (const key of ['bg', 'fg', 'line', 'glob', 'globAmount', 'shape', 'speed', 'morph', 'reach']) state[key] = p[key];
  state.pivots = p.pivots.map(([x, y, angle]) => ({ x, y, angle }));
  active = 0;
  setTool(null);
  applyColors();
  syncDock();
  markPreset(index);
  if (p.font !== state.font) await useFont(p.font);
}

// Rings the preset that was applied, until a setting is changed by hand.
function markPreset(index) {
  document.querySelectorAll('#presets button').forEach((b, i) => b.setAttribute('aria-pressed', i === index));
}

async function useFont(index) {
  const fontSelect = document.getElementById('font');
  if (!fonts[index]) {
    fontSelect.disabled = true;
    try {
      fonts[index] = await loadFont(FONTS[index].url, FONTS[index].name);
    } finally {
      fontSelect.disabled = false;
    }
  }
  state.font = index;
  fontSelect.value = index;
  buildLayout();
}

async function addFontFile(file) {
  if (!file || !/\.(ttf|otf)$/i.test(file.name)) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  FONTS.push({ name, url: URL.createObjectURL(file) });
  const index = FONTS.length - 1;
  const option = new Option(name, index);
  const fontSelect = document.getElementById('font');
  fontSelect.insertBefore(option, fontSelect.querySelector('option[value="upload"]'));
  await useFont(index);
}

function buildDock() {
  // Presets: a tile per look, showing its colors.
  const tiles = document.getElementById('presets');
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.textContent = 'Aa';
    b.title = p.name;
    b.setAttribute('aria-label', `Preset: ${p.name}`);
    b.style.background = p.bg;
    b.style.color = p.fg;
    if (p.globAmount) {
      const dot = document.createElement('i');
      dot.style.background = p.glob;
      b.append(dot);
    }
    b.addEventListener('click', () => applyPreset(i));
    tiles.append(b);
  });
  // Changing anything by hand means it's no longer that preset.
  document.getElementById('dock').addEventListener('input', () => markPreset(-1));

  // Font
  const fontSelect = document.getElementById('font');
  FONTS.forEach((f, i) => fontSelect.add(new Option(f.name, i)));
  fontSelect.add(new Option('Upload font…', 'upload'));
  fontSelect.value = state.font;
  syncs.push(() => (fontSelect.value = state.font));
  const fileInput = document.getElementById('font-file');
  fontSelect.addEventListener('change', () => {
    if (fontSelect.value === 'upload') {
      fontSelect.value = state.font;
      fileInput.click();
    } else {
      useFont(Number(fontSelect.value));
    }
    fontSelect.blur(); // hand typing back to the canvas
  });
  fileInput.addEventListener('change', () => addFontFile(fileInput.files[0]));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    addFontFile(e.dataTransfer.files[0]);
  });

  bindRange('size', 'size', (v) => `${v}px`);
  bindRange('tracking', 'tracking', (v) => `${v}%`);
  bindRange('leading', 'leading', (v) => `${v}%`);
  bindRange('glob-amount', 'globAmount', (v) => (v ? `${v}` : 'Off'));
  bindRange('speed', 'speed', (v) => (v ? `${(v / 6).toFixed(1)} rpm` : 'Still'));
  bindRange('morph', 'morph', (v) => (v > 0 ? `Out ${v}` : v < 0 ? `In ${-v}` : 'Off'));
  bindRange('reach', 'reach', (v) => `${v}%`);

  // Colors. The line follows the text color until it's given its own.
  for (const key of ['bg', 'fg', 'line', 'glob']) {
    const input = document.getElementById(key);
    const show = () => (input.value = key === 'line' ? lineColor() : state[key]);
    show();
    syncs.push(show);
    input.addEventListener('input', () => {
      state[key] = input.value;
      if (key === 'bg') applyColors();
      if (key === 'fg' && state.line === null) document.getElementById('line').value = state.fg;
    });
  }

  // Shape
  const shapeButtons = document.querySelectorAll('#shape button');
  const syncShape = () =>
    shapeButtons.forEach((b) => b.setAttribute('aria-checked', b.dataset.value === state.shape));
  shapeButtons.forEach((b) => {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      state.shape = b.dataset.value;
      syncShape();
      markPreset(-1);
    });
  });
  syncShape();
  syncs.push(syncShape);

  // Toggles
  for (const [id, key] of [['show-line', 'showLine'], ['hover', 'hover']]) {
    const box = document.getElementById(id);
    const show = () => (box.checked = state[key]);
    show();
    syncs.push(show);
    box.addEventListener('change', () => (state[key] = box.checked));
  }

  // Lines: tools, then preset spots that do what the tool does.
  for (const name of ['add', 'remove']) {
    document.getElementById(`tool-${name}`).addEventListener('click', () => setTool(tool === name ? null : name));
  }
  document.getElementById('reset-lines').addEventListener('click', resetLines);
  const grid = document.getElementById('pivot');
  const names = ['Top left', 'Top', 'Top right', 'Left', 'Center', 'Right', 'Bottom left', 'Bottom', 'Bottom right'];
  PIVOT_PRESETS.forEach(([x, y], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.xy = `${x},${y}`;
    b.title = names[i];
    b.setAttribute('aria-label', `Line spot: ${names[i].toLowerCase()}`);
    b.addEventListener('click', () => {
      if (tool === 'remove') {
        for (const p of pivotsOn(x, y)) removePivot(state.pivots.indexOf(p));
      } else if (tool === 'add' || !state.pivots.length) {
        addPivot(x * width, y * height);
      } else {
        Object.assign(state.pivots[active], { x, y });
        syncPivotGrid();
      }
    });
    grid.append(b);
  });
  syncPivotGrid();
  syncs.push(syncPivotGrid);

  // Export
  document.getElementById('export-png').addEventListener('click', exportPNG);
  document.getElementById('export-svg').addEventListener('click', exportSVG);
  const videoBtn = document.getElementById('export-video');
  videoBtn.addEventListener('click', () => exportVideo(videoBtn));
}
