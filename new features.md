Yes. The practical answer is: **don’t try to clone SpeedTree feature-for-feature first**. Build a **procedural botanical skeleton + mesh/leaf compiler + wind/LOD/export system** that runs in the browser, then add SpeedTree-like authoring affordances on top.

SpeedTree’s important pattern is not one secret algorithm. Its core is a **generator hierarchy**: trunk generator → branch generators → twig generators → leaf/frond/flower generators, where each generator creates nodes/geometry from tunable properties, then artists can override with curves, forces, manual editing, scanned meshes, wind weights, LODs, and export pipelines. Unity’s SpeedTree docs describe it exactly this way: procedural generators create branch/leaf/frond nodes, with generation properties controlling count and placement; then manual editing refines the result. ([Unity Documentation][1])

## 1. What SpeedTree is probably doing conceptually

A Three.js alternative should model plants as **hierarchical procedural graphs**, not as monolithic meshes.

The internal representation should be something like:

```ts
Plant
  SpeciesPreset
  GeneratorGraph
    TrunkGenerator
    BranchGenerator(level=1)
    BranchGenerator(level=2)
    TwigGenerator
    LeafGenerator
    FlowerGenerator
    FruitGenerator
    RootGenerator
  Skeleton
    internodes, buds, branch curves, radii, age, tropism, wind weights
  MeshCompiler
    bark tubes, knots, seams, leaves, cards, fronds, flowers
  RuntimePackage
    LOD0/LOD1/LOD2/impostor, wind attributes, materials, seed metadata
```

SpeedTree exposes this through “generators,” “nodes,” and generation properties. Leaves also use botanical placement modes such as opposite, decussate, alternating, and whorled arrangements; SpeedTree calls out phyllotaxy as a placement mode that can be used for leaves, twigs, or other geometry. ([Unity Documentation][2])

The killer features to copy are:

1. **Procedural-first, editable-second**
2. **Skeleton-first, mesh-second**
3. **Species presets as parameter bundles**
4. **Biological controls exposed as artist controls**
5. **Wind and LOD baked into vertex attributes**
6. **Instancing, leaf atlases, and impostors for real-time scenes**
7. **Optional scanned trunk/branch integration**

SpeedTree’s modern workflow also supports scanned/hero mesh integration. Its docs describe converting scanned trunk meshes into reusable procedural SpeedTree geometry and extracting tileable textures/heightmaps from mesh regions. ([Unity Documentation][3]) For your system, that means photogrammetry should be an **input texture/shape source**, not the primary asset representation.

---

## 2. The algorithm families worth implementing

### A. Weber–Penn / Honda recursive tree model

This is the best MVP foundation. The classic “Creation and Rendering of Realistic Trees” model by Weber and Penn is still a good practical basis because it was designed to generate many species-like trees with a compact parameter set; the paper explicitly targets trees, shrubs, bushes, palms, cacti, and grasses. ([Duke Computer Science][4])

The model is essentially recursive branching:

```txt
branch(level n):
  length = parent.length * lengthScale[n] * random()
  radius = pipeModel(parent, childCount)
  curve = bend + tropism + noise
  children = count[n]
  for child:
    place along parent at relative position
    rotate by branchAngle[n], rollAngle, phyllotaxis
    branch(level n+1)
```

This is not the most biologically realistic, but it is fast, controllable, and easy to expose as UI sliders.

Use it for:

* pines
* oaks
* maples
* palms
* shrubs
* fantasy trees
* game-ready trees
* asset pack generation

It gives you a reliable “SpeedTree basic mode.”

### B. L-systems / parametric stochastic L-systems

L-systems are the old-school plant grammar system. They are excellent for formal botanical patterns, ferns, flowers, vines, succulents, grasses, and repeatable species definitions. Recent work still describes L-systems as successful for simulating plants, and L-system inference remains an active problem because hand-authoring complex rules is difficult. ([arXiv][5])

Basic structure:

```txt
axiom: A
rules:
  A -> F[+A][-A]FA
  F -> FF
iterations: 5
turtle interpreter:
  F = grow segment
  + = yaw
  - = yaw other way
  [ = push transform
  ] = pop transform
```

For your tool, I would not make raw L-system editing the main UI. I would make it an **advanced generator backend** with visual nodes.

Good for:

* ferns
* flowers
* procedural vines
* stylized plants
* botanical species patterns
* repeatable asset variation

Bad for:

* mature tree crown realism without lots of extra heuristics
* artist-friendly direct control
* natural self-pruning unless extended

### C. Space colonization

This is one of the best algorithms for natural-looking tree crowns. Runions, Lane, and Prusinkiewicz extended a leaf venation model into 3D tree modeling and showed that it generates realistic tree structures with parameters corresponding to visual landscaping traits. 

The algorithm:

1. Fill a crown volume with attraction points.
2. Start with a trunk/seed branch.
3. For each growth tip, find nearby attraction points.
4. Grow the tip toward the average direction of nearby attractors.
5. Remove attractors that have been “reached.”
6. Repeat until the crown is filled.

Pseudocode:

```ts
for step in growthSteps:
  spatialIndex.clear()
  spatialIndex.insert(activeTips)

  for attractor in attractors:
    nearestTip = findNearestTip(attractor)
    if distance < killRadius:
      remove attractor
    else if distance < influenceRadius:
      nearestTip.accumulatedDir += normalize(attractor.pos - nearestTip.pos)
      nearestTip.count++

  for tip in activeTips:
    if tip.count > 0:
      dir = normalize(tip.accumulatedDir / tip.count)
      dir = mix(dir, tropism, tropismStrength)
      newTip = tip.pos + dir * segmentLength
      add segment tip -> newTip
```

Use it for:

* mature deciduous trees
* shrubs
* crown-constrained trees
* “grow inside this silhouette” authoring
* generating variation from rough 3D shape masks

This should be your **hero-tree realism mode**.

### D. Self-organizing trees: light, space, apical control

The self-organizing tree model by Pałubicki et al. is especially important if you want realism beyond recursive fractals. It integrates local branching geometry, competition for light/space, and internal signaling; the authors report that well-balanced branch distributions emerge automatically, improving realism and enabling a wide range of tree forms. 

This matters because real mature trees are not clean recursive fractals. Buds abort, branches die, crowns self-prune, and light competition shapes the form.

Implement this later as:

```ts
for each bud:
  light = sampleHemisphereOcclusion(bud.position)
  vigor = parentVigor * apicalSignal * light
  if vigor < threshold:
    bud.dormantOrDead = true
  else:
    growBranch(vigor)
```

Core concepts:

* **apical dominance**: main leader suppresses side buds
* **phototropism**: grow toward light
* **gravitropism**: trunks up, branches droop or rise depending species
* **self-pruning**: branches die when shaded
* **resource/vigor flow**: trunk and major branches get more growth energy

This is how you get recognizable differences between:

* excurrent trees: spruce, fir, conical pines
* decurrent trees: oak, maple, broad crowns
* shrubs: many co-dominant stems
* vines: environment-following growth

### E. Phyllotaxis and golden-angle placement

This is highly relevant to your earlier phi/golden-ratio intuition. Many plant organs are placed by phyllotactic rules. SpeedTree has explicit phyllotaxy generation modes including opposite, decussate, alternating, and whorled arrangements. ([Unity Documentation][2])

For spirals, use:

```txt
angle_i = i * 137.507764°
height_i = i * internodeLength
radius_i = branchRadius
```

Use this for:

* leaves around stems
* pine needles
* buds
* sunflower heads
* cones
* succulents
* flowers
* fruit placement

Important: phi should not be the whole plant generator. It should be a **placement rule** inside a broader developmental model.

### F. Environmental forces / artist forces

SpeedTree exposes “forces” as world-space objects that manipulate branch spine shapes; documented force types include direction and magnet forces. ([Unity Documentation][6])

You absolutely want this in your Three.js tool because it gives artists control without destroying proceduralism.

Implement:

```ts
interface ForceField {
  type: "direction" | "magnet" | "curl" | "avoid" | "surfaceFollow" | "windShape";
  position?: Vec3;
  direction?: Vec3;
  radius: number;
  strength: number;
  falloff: Curve;
}
```

Use forces for:

* tree leaning over a path
* branches avoiding walls
* bonsai shaping
* wind-swept coastal trees
* vines climbing a trellis
* crown silhouettes
* magical/fantasy shaping

### G. Functional-structural plant modeling

For scientific realism, look at Helios. Helios is an open-source C++ plant/environment modeling framework with plugins for radiation transport, energy balance, stomatal conductance, photosynthesis, solar position, and procedural tree generation. ([baileylab.ucdavis.edu][7]) PyHelios exposes plant modeling, geometry manipulation, biophysical simulation, GPU-accelerated radiation transfer, photosynthesis, and plant architecture modeling from Python. ([plantsimulationlab.github.io][8])

This is probably overkill for game assets, but very relevant if you want:

* growth over time
* species parameters grounded in measurable plant traits
* ML-compatible plant encodings
* agricultural/phenotyping simulation
* radiation/light-driven morphology

The 2025 Helios plant architecture framework is especially interesting because it targets procedural static and dynamic plant geometry, species-conserved measurable parameters, character-based structure encoding for ML, and efficient collision physics. ([arXiv][9])

For your system, steal the idea of **botanically meaningful parameters**, but keep the UI artist-friendly.

---

## 3. Recommended architecture for a Three.js / WebGPU SpeedTree alternative

I’d build it as three layers:

```txt
Layer 1: Plant IR
  Deterministic plant skeleton, organ graph, species parameters, curves, seed

Layer 2: Procedural compiler
  Skeleton generation → mesh generation → material assignment → wind weights → LODs

Layer 3: Authoring/runtime
  Three.js editor, WebGPU preview, GLB/USD export, instancing, terrain scattering
```

### Plant intermediate representation

Use a skeleton/organ graph:

```ts
type PlantNodeType =
  | "root"
  | "trunk"
  | "branch"
  | "twig"
  | "leaf"
  | "needle"
  | "frond"
  | "flower"
  | "fruit"
  | "thorn"
  | "aerialRoot";

interface PlantNode {
  id: string;
  parentId?: string;
  type: PlantNodeType;
  order: number;          // branch level
  age: number;
  length: number;
  radiusBase: number;
  radiusTip: number;
  curve: CubicBezier[];   // or sampled polyline
  transform: Mat4;
  materialSlot: string;
  vigor: number;
  wind: WindWeights;
  children: string[];
}
```

Keep geometry separate:

```ts
interface PlantGeometryPackage {
  skeleton: PlantNode[];
  meshes: {
    bark: BufferGeometry;
    leaves: InstancedMesh | BufferGeometry;
    flowers?: InstancedMesh;
    fruits?: InstancedMesh;
  };
  lods: LODPackage[];
  materials: PlantMaterial[];
  impostors?: BillboardAtlas;
}
```

This matters because you can regenerate mesh resolution, LOD, wind, or materials without changing the plant’s biological structure.

---

## 4. Mesh generation: what actually makes it look realistic

### Branch and trunk geometry

Do not just make cylinders. Use swept generalized cylinders along branch curves:

1. Sample curve.
2. Build Frenet/parallel-transport frames.
3. Radius decreases along branch.
4. Cross-section becomes irregular/noisy.
5. Stitch child branches into parent.
6. Add bark displacement and normal maps.

Use **parallel transport frames**, not naive Frenet frames, to avoid twisting artifacts.

Branch radius should follow something like the pipe model:

```txt
parentRadius^p = sum(childRadius_i^p)
```

Usually `p ≈ 2` to `3`, artist-adjustable.

At branch junctions, add:

* collar swelling
* smooth blending
* knot decals
* vertex color AO
* bark seam hiding

For browser MVP, actual boolean/blended topology can wait. You can fake junctions with overlapping child branch bases plus bark collar geometry.

### Leaves

You need two representations:

1. **Hero leaves**: curved mesh with midrib, veins, slight asymmetry.
2. **Game leaves**: cards or small clusters using atlased textures.

Leaf placement should include:

* phyllotaxy mode
* size variation
* curl
* bend around midrib
* sun-facing orientation
* gravity droop
* clustering
* random missing leaves
* age/color variation

SpeedTree’s wind docs emphasize that leaf/frond profile curves control ripple and branch profile curves control bending, which maps nicely to vertex attributes. ([Unity Documentation][10])

### Bark and material generation

Minimum viable material system:

```ts
interface BarkMaterialParams {
  baseColor: Texture | ProceduralNoise;
  normal: Texture | ProceduralNoise;
  roughness: number;
  height: Texture | ProceduralNoise;
  verticalCrackScale: number;
  ringNoise: number;
  mossAmount: number;
  lichenAmount: number;
  wetness: number;
}
```

For realism:

* Use triplanar or cylindrical bark UVs.
* Store branch coordinate attributes: `branchU`, `branchV`, `branchOrder`, `age`.
* Add procedural darkening at branch junctions.
* Use AO baked from skeleton proximity.
* Add decals for knots, scars, cut branches, fungus.

### Flowers, fruit, cones, needles

These should be organ generators, not special cases. A pine cone is a phyllotactic scale generator. A flower is a radial/spiral organ generator. A grass clump is many blade generators from a crown.

```ts
OrganGenerator:
  placement: phyllotactic | radial | cluster | terminal | random
  meshPrototype: leaf | petal | coneScale | fruit | needle
  count
  scaleCurve
  orientationRule
  maturity
```

---

## 5. Wind system for Three.js/WebGPU

SpeedTree-like wind should be **vertex-shader driven**. SpeedTree’s Lumberyard integration uses vertex colors where red controls fine leaf/frond bending, green timing offset, and blue branch motion amount; it also uses generator wind profile curves for branch bend and leaf ripple. ([Unity Documentation][10])

For your own format, do not overload RGB semantically unless exporting. Use explicit attributes:

```ts
attribute float windBranchWeight;
attribute float windLeafWeight;
attribute float windPhase;
attribute float windFlutter;
attribute float branchDepth;
attribute vec3  branchAnchor;
attribute vec3  branchAxis;
```

Shader concept:

```glsl
float gust = sin(time * gustFreq + windPhase) * gustStrength;
float flutter = sin(time * flutterFreq + windPhase * 13.7) * windFlutter;
vec3 bendDir = normalize(windDirection);

vec3 displaced = position;
displaced += bendDir * gust * windBranchWeight * branchDepth;
displaced += normal * flutter * windLeafWeight;
```

Better version:

* bend branches around anchor point
* use branch hierarchy IDs
* leaf ripple along local leaf UV
* low-frequency trunk sway
* medium branch sway
* high-frequency leaf flutter
* gust noise texture

For imported “hero meshes,” SpeedTree adds spines to meshes and computes wind weights from those spines; the docs describe adding spine hierarchy, applying wind, computing weights from spines, and manually fixing bad assignments. ([Unity Documentation][11]) You can implement the same: let users draw or auto-fit a skeleton over a mesh, then compute closest-spine weights.

---

## 6. LOD and real-time rendering

A browser alternative lives or dies on LOD.

SpeedTree’s game pipeline includes optimized geometry, LOD states, billboard atlases, shaders, culling, wind, and rendering support. ([YouTube][12]) SpeedTree game exports also support billboard impostors for LOD. ([Unity Documentation][13])

Your LOD stack should be:

```txt
LOD0: full trunk/branches + individual leaf meshes/cards
LOD1: simplified branches + leaf clusters
LOD2: trunk + clumped foliage cards
LOD3: cross-card/tree impostor
LOD4: baked billboard/hemisphere impostor
```

For forests:

* Use `InstancedMesh` or custom WebGPU indirect draws.
* Share leaf/branch prototypes across trees.
* Generate per-instance seeds and morph parameters.
* Use impostor atlases for far trees.
* Use clustered culling or BVH.
* Avoid one draw call per tree.

For Three.js today:

* MVP: `InstancedMesh`, merged `BufferGeometry`, MeshBVH for selection.
* Advanced: WebGPU renderer, storage buffers, compute-based culling, indirect draw when available.

---

## 7. Existing open-source/browser references

Useful things to inspect, but not necessarily copy wholesale:

* **FloraSynth**: a Three.js procedural tree/plant generator with presets and OBJ export. ([three.js forum][14])
* **Tree-js**: browser tree generator with controls for trunk, branches, geometry, leaves, sun direction, maturity, colors, levels, angles, opacity, emissive, and GLB export. ([80 Level][15])
* **EZ-Tree**: procedural tree generator with 50+ tunable parameters, presets, GLB/PNG export, and an NPM package. ([Three.js Resources][16])
* **PyHelios / Helios**: more scientific, useful for biologically grounded growth and plant/environment simulation. ([plantsimulationlab.github.io][8])

I would use these as reconnaissance, but build your own IR and compiler. Most hobby tree generators stop at “nice random trees.” The differentiator is **asset-production quality**: authoring, mesh quality, wind, LOD, material atlases, export, and species presets.

---

## 8. Concrete MVP plan

### Phase 1: “WeberTree” MVP

Goal: generate nice game-ready trees in browser and export GLB.

Features:

* deterministic seed
* trunk + 3 branch levels
* branch curves
* radius taper
* leaf cards
* bark material
* basic wind attributes
* GLB export
* 10 presets: oak, pine, birch, maple, palm, shrub, willow, dead tree, fantasy tree, bonsai

Core algorithms:

* recursive Weber–Penn branching
* phyllotactic placement
* tropism
* simple mesh tubes
* leaf atlas cards
* LOD simplification by branch order

### Phase 2: SpeedTree-like editor

Add:

* generator graph UI
* curve editors
* force fields
* branch pruning brush
* seed randomizer
* species preset save/load
* leaf atlas importer
* material graph lite
* GLB + custom `.plant.json`

This is where it starts feeling like a real tool.

### Phase 3: Space colonization crown mode

Add:

* crown volume editor
* attractor point sampling
* grow-inside-shape mode
* branch density controls
* light exposure pruning
* silhouette matching from image/mask

This gets you mature broadleaf realism.

### Phase 4: Advanced plant organs

Add:

* flowers
* fruit
* cones
* grasses
* ferns
* vines
* roots
* aerial roots
* thorns
* moss/lichen decals

### Phase 5: Runtime forest system

Add:

* terrain scattering
* ecosystem placement
* density maps
* biome presets
* instancing
* impostor baking
* WebGPU culling
* seasonal variation

Open-source forest-generation work commonly combines specialized L-systems for trees with ecosystem simulation for placement, then renders with real-time transparency and lighting effects. ([arXiv][17])

---

## 9. Suggested technical stack

For the app:

```txt
React / Svelte / Solid
Three.js
Three.js WebGPU renderer where possible
Rapier or custom simple collision for vines/branches
glTF-Transform for GLB optimization
MeshBVH for picking/selection
Zustand/Jotai or similar for editor state
```

For geometry:

```txt
Plant IR JSON
BufferGeometry compiler
InstancedMesh for leaves
Merged geometry for branches
KHR_materials_variants for seasonal variants
EXT_mesh_gpu_instancing where useful
KTX2/Basis textures
```

For algorithms:

```txt
@plant/growth-weber
@plant/growth-lsystem
@plant/growth-colonization
@plant/mesh-branches
@plant/mesh-organs
@plant/wind
@plant/lod
@plant/export-gltf
```

For data:

```json
{
  "species": "acer_rubrum",
  "seed": 12345,
  "architecture": {
    "mode": "weber-penn",
    "levels": 4,
    "branchCounts": [1, 12, 8, 5],
    "lengthScale": [1.0, 0.42, 0.35, 0.22],
    "branchAngles": [0, 42, 58, 71],
    "tropism": [0, 0.25, 0],
    "phyllotaxy": "alternate-golden"
  },
  "materials": {
    "bark": "bark_oak_01",
    "leaf": "leaf_maple_01"
  },
  "wind": {
    "trunkSway": 0.15,
    "branchSway": 0.45,
    "leafFlutter": 0.9
  }
}
```

---

## 10. The “secret sauce” for realism

The realism does not come from one algorithm. It comes from layering constraints:

```txt
recursive architecture
+ phyllotactic organ placement
+ tropism
+ light/space competition
+ branch death/pruning
+ asymmetric noise
+ species presets
+ good bark/leaves
+ wind
+ LOD/impostors
```

The biggest mistakes to avoid:

1. **Perfect symmetry**
   Real trees are biased, damaged, shaded, and opportunistic.

2. **Uniform branch thickness**
   Use pipe-model-like radius conservation.

3. **Leaves as random confetti**
   Leaves need botanical placement, clustering, sun orientation, and missing/aged variation.

4. **Cylindrical branches with obvious seams**
   Add collars, knots, noise, and texture continuity.

5. **No branch hierarchy in wind**
   Good wind needs trunk/branch/leaf frequencies, not one global sine wave.

6. **Too much geometry too far away**
   LOD/impostors are mandatory.

---

## 11. My recommendation for your build

Given your 3D asset pipeline goals, I’d build this as a **browser-native procedural plant asset compiler**, not just a viewer.

Name the internal representation something like:

```txt
PlantIR
  .plant.json + geometry compiler
```

Then support:

```txt
Generate → Edit → Bake → Export GLB → Use in Three.js/Unity/Unreal/asset packs
```

The MVP should be:

* Weber–Penn recursive tree generator
* phyllotaxis leaf/twig generator
* spline/tube branch mesher
* leaf atlas cards
* seed/preset system
* GLB export
* vertex-attribute wind
* 3 LODs

Then add:

* space colonization for realistic crowns
* force fields
* pruning/light simulation
* scanned trunk texture extraction
* flowers/fruits/vines/grass
* impostor baker

That is a very plausible Three.js/WebGPU “SpeedTree-lite” that can become more than lite if you emphasize clean IR, deterministic generation, GLB export, and asset-pack production from day one.

[1]: https://docs.unity3d.com/speedtree-modeler/manual/modeling-approach.html "Modeling approach "
[2]: https://docs.unity3d.com/speedtree-modeler/manual/phyllotaxy-generation-mode.html "Phyllotaxy "
[3]: https://docs.unity3d.com/speedtree-modeler/manual/mesh-converter-generator.html "Mesh converter generator "
[4]: https://courses.cs.duke.edu/cps124/fall01/resources/p119-weber.pdf?utm_source=chatgpt.com "Creation and Rendering of Realistic Trees"
[5]: https://arxiv.org/abs/1712.00180?utm_source=chatgpt.com "New Techniques for Inferring L-Systems Using Genetic Algorithm"
[6]: https://docs.unity3d.com/speedtree-modeler/manual/forces.html "Forces "
[7]: https://baileylab.ucdavis.edu/research/index.html?utm_source=chatgpt.com "Helios Plant and Environmental Modeling Framework"
[8]: https://plantsimulationlab.github.io/PyHelios/?utm_source=chatgpt.com "PyHelios"
[9]: https://arxiv.org/abs/2512.17966?utm_source=chatgpt.com "A generalized framework for procedural generation of three-dimensional static and dynamic plant model geometries"
[10]: https://docs.unity3d.com/speedtree-modeler/manual/wind-lumberyard.html "Lumberyard wind "
[11]: https://docs.unity3d.com/speedtree-modeler/manual/add-wind-rigging-to-hero-mesh.html "Add wind rigging to a hero mesh "
[12]: https://www.youtube.com/watch?v=YEWXbqI_be8&utm_source=chatgpt.com "SpeedTree Games/SDK Pipeline Walkthrough"
[13]: https://docs.unity3d.com/speedtree-modeler/manual/games-export-options.html?utm_source=chatgpt.com "Games export options"
[14]: https://discourse.threejs.org/t/florasynth-procedural-tree-generator/58740?utm_source=chatgpt.com "Florasynth procedural tree generator - Showcase"
[15]: https://80.lv/articles/open-source-three-js-procedural-tree-generator-in-the-browser?utm_source=chatgpt.com "Open-Source Three.js Procedural Tree Generator In The ..."
[16]: https://threejsresources.com/tool/ez-tree?utm_source=chatgpt.com "EZ-Tree"
[17]: https://arxiv.org/abs/2208.01471?utm_source=chatgpt.com "Procedural Generation and Rendering of Realistic, Navigable Forest Environments: An Open-Source Tool"

---

## 12. Additions that would move this closer to SpeedTree level

The PRD already covers the big algorithmic foundation. The missing layer is mostly **production authoring and asset packaging**: the stuff that turns a good generator into a daily vegetation tool. SpeedTree 10 publicly emphasizes procedural generators plus manual art tools, production-ready libraries, shader/vertex-color wind, dynamic LOD, atlas and billboard export, photogrammetry, physics vines, trim, and spine rigging for meshes. ([Unity SpeedTree][18]) Its Modeler documentation also has dedicated areas for cutouts, generator graphs, rules, leaf collision, mesh anchors, clusters, shape control, vertex colors/features, trim, hand draw, click place, vines, seasons, collision objects, texture atlases, photogrammetry, mesh helpers, wind, LOD, command-line export, and custom data packing. ([Unity Documentation][19])

Add these as explicit product requirements:

### A. Generator graph authoring with live dependency previews

The tool should expose the plant as a small generator graph, not just a flat slider list:

```txt
Tree
  Trunk
    Branch L1
      Branch L2
        Twig
          Leaves / needles / flowers / fruit
    Roots
    Vines / decals / knots
```

Each generator needs:

* enabled/disabled state
* seed override
* count and placement mode
* parent attachment scope
* curve controls
* viewport debug overlay
* copy/paste between species

This is the authoring surface that makes Weber/Penn, Procplants fill, vines, flowers, and future crown modes feel like one coherent system.

### B. Cutout and atlas builder

SpeedTree-level foliage needs a browser-native cutout workflow:

* import leaf, needle, frond, bark, flower, cone, and fruit textures
* trace alpha into optimized mesh cutouts
* pack cutouts into atlases
* preserve pivot, stem attachment point, normal direction, and bend axis
* generate mip-safe padding
* export atlas metadata into PlantIR

This is probably one of the highest-impact upgrades for realism. Procedural cards become much more convincing once the user can bring real leaf silhouettes and reuse them across presets.

### C. Branch attachment, collision, and pruning tools

Add a real edit mode for branch and organ placement:

* click-place branch, leaf cluster, vine, knot, decal, or fruit on a stem
* trim/prune brush that removes branches below a screen-space or lasso stroke
* collision/avoidance volumes for leaves and branches
* leaf collision relaxation to reduce card intersections
* preserve procedural regeneration after edits by storing overrides as graph operations

This directly addresses the work we are already doing with sprays landing on branch ends: attachment needs to become a first-class concept, not an incidental sampling detail.

### D. Rules and macro controls

Add a lightweight rule system so a few named sliders can drive many low-level properties:

```ts
rule "wind swept":
  branchAngle.mean += exposure * 12
  crown.asymmetry += exposure * 0.45
  foliage.tipBias += exposure * 0.25
  trunkBend += exposure * 0.18
```

Initial macro controls:

* age
* season
* health
* wind exposure
* wetness
* snow load
* pruning intensity
* stylization
* biome adaptation

These make the tool feel art-directable instead of parameter-heavy.

### E. Seasons, growth stages, and variants

Add variants as a core output, not a later polish pass:

```txt
same PlantIR
  spring: buds + young leaves + flowers
  summer: full foliage
  autumn: color shift + leaf drop
  winter: sparse/dead leaves + snow mask
  damaged: broken branches + scars
```

Requirements:

* per-organ age and health
* leaf color ramps
* leaf drop masks
* blossom/fruit/cone maturity
* snow and wetness material masks
* variant preview strip in the UI
* export variants as separate GLBs or material/visibility variants

### F. Vines and surface-following growth

SpeedTree 10 specifically calls out physics-based vines. Procplants should add a vine generator that can:

* hang from branches
* climb trunks
* follow guide curves
* wrap around target stems
* collide with coarse branch/trunk volumes
* place leaves/flowers/fruit along vine nodes

This also helps Tellus scenes: vines, roots, ivy, hanging moss, and lianas make generated biomes look much less like isolated tree assets.

### G. Mesh helper and hero asset workflow

Add a bridge for imported/scanned/static meshes:

* import trunk or branch mesh
* draw or auto-fit spine curves
* assign bark coordinates and wind weights from those spines
* attach procedural branches/leaves to mesh anchors
* extract or assign tileable bark textures
* blend procedural branch collars into the static mesh

This lets the tool use photogrammetry or hand-modeled hero trunks without abandoning procedural editability.

### H. Export profiles and automated asset QA

SpeedTree is production valuable because export is part of the product. Add named export profiles:

```txt
Tellus realtime
Three.js GLB
Unity URP
Unreal foliage
Cinema hero mesh
Mobile low-poly
Billboard/impostor only
```

Each profile should define:

* max triangles
* max draw calls/materials
* texture size and packing
* LOD distances
* wind attribute packing
* billboard/impostor settings
* collision export
* metadata schema

Add an asset QA panel:

* triangle and vertex counts by LOD
* draw call estimate
* overdraw estimate for leaves
* texture memory estimate
* missing UVs/normals/tangents
* broken alpha/cutout warnings
* branch/leaf intersection warnings
* export readiness score

### I. Command-line/batch compiler

For asset-pack production, add a headless compiler:

```txt
procplants compile ./species/oak.plant.json --profile tellus-realtime --variants 20
procplants atlas ./textures/leaves --size 2048
procplants validate ./dist/oak_*.glb
```

This matters because a SpeedTree-like tool is not just an editor; it is a repeatable production pipeline.

### J. Immediate next features for this repo

Based on the current Procplants/Biome Mixer state, the nearest useful steps are:

1. Promote Weber/Penn stem endpoints, leaf anchors, and Procplants fill anchors into a shared attachment-anchor system.
2. Add debug overlays for anchors, branch order, wind weight, and LOD level.
3. Add leaf/needle/frond cutout import with pivot and attachment metadata.
4. Add a pruning/trim brush for Weber/Penn trees.
5. Add per-preset export/readiness stats: triangles, leaves, stems, materials, and LOD budget.
6. Add season and health variants to saved presets.
7. Add a Tellus export profile that bakes the current biome mix plus saved presets into a deterministic runtime package.

If the goal is SpeedTree caliber, these are more urgent than adding more species sliders. They create the authoring and pipeline surface that makes advanced algorithms usable.

[18]: https://unity.com/products/speedtree "SpeedTree"
[19]: https://docs.unity3d.com/speedtree-modeler/manual/doc-map.html "SpeedTree Modeler documentation map"
