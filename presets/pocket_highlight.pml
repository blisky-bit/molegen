bg_color white
set ray_opaque_background, off
set antialias, 2
set orthoscopic, on

hide everything
show cartoon, mol
color gray70, mol

# Try to detect ligand (non-polymer, non-solvent)
select lig, mol and not polymer and not solvent

# Decide pocket selection based on ligand existence
python
from pymol import cmd

# fallback (edit these defaults)
fallback_sel = "mol and chain A and resi 50-70"

if cmd.count_atoms("lig") == 0:
    print("[INFO] No ligand detected. Using fallback residue range.")
    cmd.select("pocket", fallback_sel)
else:
    print("[INFO] Ligand detected. Using ligand-based pocket.")
    cmd.select("pocket", "byres (mol within 4 of lig)")
python end

# Visualize ligand only if it exists (optional: safe even if empty)
show sticks, lig
color tv_orange, lig

# Visualize pocket (fast mode: sticks instead of surface)
show sticks, pocket
color cyan, pocket

# Optional: slightly transparent protein
set cartoon_transparency, 0.15, mol
