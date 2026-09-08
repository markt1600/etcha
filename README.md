# Etcha

An Etch A Sketch that draws your pictures.

Drop in an image and a virtual Etch A Sketch traces it as one unbroken line,
knobs twisting in real time. Adjust the speed, outline detail and shading, watch the thumbnail
of what it is drawing, then shake to erase.

## How it works

Everything runs client-side, no build step:

- `js/tracer.js` turns the image into a single continuous path, the way the
  professional Etch A Sketch artists work:
  - Outlines: grayscale → Gaussian blur → Sobel → hysteresis threshold →
    morphological closing → Zhang-Suen thinning → contour tracing →
    Ramer–Douglas–Peucker simplification.
  - Shading: nested levels of horizontal hatching whose spacing halves per
    level, so darks become solid fills, mid-tones get sparser lines, and
    highlights stay clean.
  - Planning: strokes are ordered greedily by proximity, and every move between
    strokes is routed with A* over a cost map that prefers dark regions and
    lines already drawn, so the connecting lines hide inside the picture.
    Since the stylus can never lift, those moves are part of the path (there is
    a cheat toggle to hide them).
  Planning runs in a Web Worker (`js/tracer.worker.js`) with a main-thread fallback.
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
