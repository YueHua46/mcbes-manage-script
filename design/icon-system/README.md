# CreeperMenu pixel icon system

This directory contains the generated source atlases for the menu's active icon set. Runtime icons are rebuilt with `design/icon-system/build.py`.

## Visual rules

- Native runtime canvas: 32×32 pixels, matching the form image control exactly.
- Safe content area: 28×28 pixels, optically centered.
- Shape language: square pixels, hard edges, compact silhouettes, no antialiasing.
- Outline: shared near-black/dark-brown palette entries.
- Shading: one main color family with a highlight and shadow; the build step maps all atlases to one compact shared palette.
- Meaning: green confirms, red warns or removes, blue navigates or informs, gold represents economy and rewards, purple marks portals or special systems.

## Atlas order

Each source image is a square grid read left-to-right, top-to-bottom. `atlas-main-menu.png` is designed directly from the current button functions and uses dedicated `menu_*` paths so old filenames cannot impose incorrect meaning.

## Rebuild

Run the script with a Python environment that provides Pillow:

```powershell
python design/icon-system/build.py
```

The source atlases were generated with the built-in image generation workflow, using a flat `#ff00ff` chroma-key background. The build removes only edge-connected key color, which protects intentional purple details inside icons.
