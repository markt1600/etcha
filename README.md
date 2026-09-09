# Etcha

An Etch A Sketch that draws your pictures.

Drop in an image and a virtual Etch A Sketch traces it as one unbroken line,
knobs twisting in real time. Adjust the speed, outline detail, shading and shading style, watch the
thumbnail of what it is drawing, then shake to erase. "Download picture" saves
a PNG of the whole toy with the current drawing (`js/snapshot.js` paints it). The sliders default to
their best-quality settings.

## How it works

Everything runs client-side, no build step:

- `js/tracer.js` turns the image into a single continuous path, the way the
  professional Etch A Sketch artists work:
  - Outlines: grayscale → Gaussian blur → Sobel → hysteresis threshold →
    morphological closing → Zhang-Suen thinning → contour tracing →
    Ramer–Douglas–Peucker simplification.
  - Shading (`js/flow.js`): local contrast is boosted with an unsharp mask,
    then an edge tangent field is built from the picture's structure tensor
    and evenly spaced streamlines are traced through it in four hierarchical
    densities. Each streamline is cut into strokes where the picture is dark
    enough for its level, so the hatching wraps around forms the way a hand
    drawn portrait does. A classic horizontal-rows mode is available too.
  - Planning: strokes are ordered greedily by proximity, and every move between
    strokes is routed with A* over a cost map that prefers dark regions and
    lines already drawn, so the connecting lines hide inside the picture.
    Since the stylus can never lift, those moves are part of the path (there is
    a cheat toggle to hide them).
  Planning runs in a Web Worker (`js/tracer.worker.js`) with a main-thread fallback.
- The drawing surface is 1000 px wide with a thin line, so fine detail survives.
  A "Real toy" fidelity mode plans at 400 px instead, which on a 15 cm screen
  gives the real stylus's 0.6 mm line and roughly 1 mm minimum feature size
  (retracing is still assumed perfect).
- `js/etch.js` animates the stylus along that path on a canvas, and rotates
  the knobs. Knob angles are a pure function of stylus position, just like
  the real toy: left knob = horizontal, right knob = vertical.
- `js/app.js` wires up drag and drop, paste, file picking, and the controls.

## Run locally

Any static file server works, for example:

```sh
npm run dev
# then open http://localhost:3000
```

## Deploy to Vercel

The site is plain static files, so Vercel needs no framework preset or build
command. Import the repository in Vercel (or run `vercel` in this directory)
and deploy with the defaults.
