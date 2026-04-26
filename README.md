# plant-to-pill
Interactive browser demos for prototyping plant drug Cyclotides ensuring safe Oral Drug delivery - no lab required.
# From Plant to Pill: Simulating cyclopeptides for Oral drug delivery

Interactive browser demos for prototyping gut-stable circular peptides — no lab required.

Built for GitHub Universe 2026 Ship & Tell submission.

## Live Demos

**1. Full Pipeline Simulator**  
Generate → Verify loop for plant cyclotides  
[Open Demo](./stochastwin-pipeline.html)

**2. Manufacturability Simulator**  
Visualize why folding yield drives cost from $80k to $4k per gram  
[Open Demo](./cyclotide-manufacturability.html)

## What it does
- dWJS Walk-Jump: adds Gaussian noise to discrete AA sequences, optimizes in continuous space, snaps back to novel peptides
- Murburn verification: scores redox safety (DCS) in a simulated cellular environment  
- Synthesis scoring: predicts cyclization yield and disulfide pairing accuracy

## Why oral delivery?
Cyclopeptides with a cystine knot survive stomach acid and heat — ideal for pills instead of injections. This tool lets you explore the design tradeoffs before synthesis.

## Run locally
```bash
git clone https://github.com/YOURUSERNAME/from-plant-to-pill
cd from-plant-to-pill
# just open the HTML files in your browser — no build step
