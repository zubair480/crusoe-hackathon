# ThermalDesk · MCC Room 3D

A 3D thermal twin of a motor control center (MCC) room in the browser. Built with plain three.js (r186, vendored), with no build step.

- Bird's-eye drone view of 4 line-ups x 5 sections x 6 buckets
- Click a bucket for a three-stage zoom: line-up, then bucket (the door swings open), then a K1 contactor close-up with a thermal scan
- A seeded 10 Hz simulation drives motor starts and stops, per-phase current, and terminal temperatures. One contactor's L2 joint overheats.
- Press T to toggle the ironbow thermal camera view. All data is simulated.

Run: `python -m http.server 8765`, then open http://localhost:8765
