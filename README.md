# Sonar text editor

A generative type tool by Noah Oh, built with [p5.js](https://p5js.org) 2.3.3.

**Try it:** https://noahohstudio.github.io/sonar-text-editor/

Lines spin around points you place. Wherever one crosses a letter, the outline pinches along it like goo. Letters nothing is touching stay exactly the font.

- **Type** anywhere to edit the text. On a phone or tablet, tap the text.
- **Controls** sit in the bar at the bottom. Hover the bottom edge or press Tab to open them. On touch screens, tap the handle.
- **Lines:** + places lines with each click, − removes them, and each line starts turning when it's placed.
- **Presets** give whole looks to start from. **Glob** colors goo that's pulled far out of its letter.
- **Export** as PNG, SVG or video.

## Run it in the p5.js web editor

[`p5-editor/sketch.js`](p5-editor/sketch.js) holds the whole tool in one file. Open https://editor.p5js.org/?version=2.3.3 and paste it into `sketch.js`. The editor's default `index.html` and `style.css` work as they are.

## Files

- `index.html`, `style.css`, `sketch.js`: the site, with no build step.
- `build-p5.mjs`: rebuilds `p5-editor/sketch.js` from those three files. Run `node build-p5.mjs` after editing them.
