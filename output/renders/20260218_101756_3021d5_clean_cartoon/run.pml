reinitialize
load C:/molegen/output/_tmp/1BXN.pdb, mol
run C:/molegen/presets/clean_cartoon.pml

# center and zoom nicely
orient mol
zoom mol, buffer=2

# render
viewport 900, 700
png C:/molegen/output/renders/20260218_101756_3021d5_clean_cartoon/result.png, dpi=150

quit
