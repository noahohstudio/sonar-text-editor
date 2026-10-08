# Sonar text editor

A generative type tool by Noah Oh, built with [p5.js](https://p5js.org) 2.3.3.

**Try it:** https://noahohstudio.github.io/sonar-text-editor/

**Random version:** https://noahohstudio.github.io/sonar-text-editor/random/ has no controls at all. Every letter you add or delete re-rolls the whole look: palette, font, line shape and motion, glob, and the lines. The roll is seeded by the text, so deleting a letter brings back the look from before it. ⌘S (Ctrl+S) saves a PNG.

Lines spin around points you place. Wherever one crosses a letter, the outline pinches along it like goo. Letters nothing is touching stay exactly the font.

- **Type** anywhere to edit the text. On a phone or tablet, tap the text.
- **Controls** sit in the bar at the bottom. Hover the bottom edge or press Tab to open them. On touch screens, tap the handle.
- **Lines:** + places lines with each click, − removes them, and each line starts turning when it's placed.
- **Presets** give whole looks to start from. **Glob** colors goo that's pulled far out of its letter.
- **Export** as PNG, SVG or video.

## Run it in the p5.js web editor

Each version is one file. Open https://editor.p5js.org/?version=2.3.3 and paste it into `sketch.js`. The editor's default `index.html` and `style.css` work as they are.

- [`p5-editor/sketch.js`](p5-editor/sketch.js): the tool with its controls.
- [`p5-editor/random-sketch.js`](p5-editor/random-sketch.js): the random version, no controls.

## Files

- `index.html`, `style.css`, `sketch.js`: the site, with no build step.
- `random/index.html`, `random/random.js`: the random version, built on the same `sketch.js`.
- `build-p5.mjs`: rebuilds both files in `p5-editor/` from the files above. Run `node build-p5.mjs` after editing them.
