from cifparse import CIFP
c = CIFP("FAACIFP18")
c.parse_airway_points()
aw = c.get_airway_points()
if aw: print("Airway:", aw[0].to_dict())

c.parse_runways()
rw = c.get_runways()
if rw: print("Runway:", rw[0].to_dict())

c.parse_fir_uir()
fir = c.get_fir_uir()
if fir: print("FIR:", fir[0].to_dict())

c.parse_holds()
hd = c.get_holds()
if hd: print("Hold:", hd[0].to_dict())

c.parse_loc_gss()
loc = c.get_loc_gss()
if loc: print("LOC:", loc[0].to_dict())
