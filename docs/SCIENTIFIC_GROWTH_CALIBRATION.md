# Scientific growth calibration contract

Procplants exposes an opt-in V1 calibration bridge for one bounded part of the
growth model: conversion of intercepted photosynthetically active radiation
(APAR) into a carbon resource budget. It does not relabel the procedural growth
simulator as a physiological model.

## Source and parameter scope

The four bundled records are plant functional types from the official NASA
LP DAAC [VNP17/VJ117 User's Guide, Version 1](https://lpdaac.usgs.gov/documents/2255/VNP17_User_Guide_V1.pdf),
Biome Properties Look-Up Table (BPLUT):

| Procplants ID | PFT | Maximum LUE (kg C/MJ APAR) | Tmin zero/full (C) | VPD full/zero (Pa) | SLA (m2/kg leaf C) |
| --- | --- | ---: | ---: | ---: | ---: |
| `vnp17-evergreen-needleleaf-forest` | Evergreen needleleaf forest | 0.001031 | -8 / 3.6 | 650 / 4636 | 15.40168 |
| `vnp17-deciduous-broadleaf-forest` | Deciduous broadleaf forest | 0.001593 | -6 / 21.4 | 650 / 3434 | 37.22949 |
| `vnp17-grassland` | Grassland | 0.001301 | -8 / 5 | 650 / 4156 | 35.75488 |
| `vnp17-cropland` | Cropland | 0.001848 | -8 / 21.5 | 650 / 4963 | 40.31786 |

The linear temperature and vapor-pressure-deficit ramps and the relationship
`GPP = epsilon * APAR` follow the official NASA
[MOD17 User's Guide](https://www.earthdata.nasa.gov/s3fs-public/2025-04/MOD17_User_Guide_V5.pdf).
The implementation records the source title, organization, version, table, and
URL in every audit. Values are not silently inferred from a Procplants species
preset.

## Unit bridge

`createProcPlantCalibratedGraphGrowthBridge` converts explicit scene and climate
inputs into the existing graph resource adapter:

- local light-probe exposure is the fraction of incident PAR in `[0, 1]`;
- incident PAR is MJ/m2/day and a timestep is 0-31 days;
- procedural organ scale is converted to projected m2 with an explicit
  meters-per-scene-unit and projected-area factor;
- production and reserves are kg C;
- tube volume is converted from scene units cubed to m3;
- maintenance and potential growth coefficients are caller supplied in
  kg C/m3/day.

`stepProcPlantCalibratedGrowthSimulation` then calls the existing stateful
resource/light simulator. The legacy evaluator, defaults, state contract, and
uncalibrated entry point are untouched; calibration is impossible without an
explicit PFT, climate, geometry scale, and carbon-budget request.

## Scientific boundary

This is a reproducible PFT-level light-use-efficiency calibration, not end-to-end
plant physiology. The procedural projected leaf area is not satellite FPAR,
there is no spectral or translucent canopy transfer, and scene tube volume is
not measured biomass. Maintenance and potential structural growth therefore
remain caller-calibrated coefficients. The existing apical dominance, vigor,
activation, topology growth, and pruning rules remain normalized heuristics.

Before species-level claims, validate against measured organ geometry/biomass,
site PAR/Tmin/VPD, time-series carbon or dry-matter accumulation, phenology and
allometry for the named species, then report out-of-sample error and parameter
uncertainty. For canopy or ecosystem claims, compare the local exposure sampler
against a radiative-transfer reference and measured FPAR/LAI.
