
reinitialize
load C:/molegen/input/test.pdb, mol
run C:/molegen/presets/clean_cartoon.pml

# center and zoom nicely
orient mol
zoom mol, buffer=2

# render
viewport 1600, 1200
ray 1600, 1200

png C:/molegen/output/test.png, dpi=300
quit
