# Aeronautical Symbols

## 1. Airports & Heliports

These are the core point markers for landing facilities.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![apt-civil-unpaved](client/src/assets/icons/carbon/apt-civil-unpaved.svg) | `apt-civil-unpaved` | Open circle | Public unpaved civil airports (`civil_soft`) |
| ![apt-ifr-civil](client/src/assets/icons/carbon/apt-ifr-civil.svg) | `apt-ifr-civil` | Open circle with 12, 3, 6, and 9 o'clock ticks | Public paved civil airports (`civil_hard`); world-space runway polygons render underneath at high zoom |
| ![apt-ifr-military](client/src/assets/icons/carbon/apt-ifr-military.svg) | `apt-ifr-military` | Double concentric circle with central dot | Military airports (`military`); ![apt-ifr-military-civil](client/src/assets/icons/carbon/apt-ifr-military-civil.svg) `apt-ifr-military-civil` variant also available |
| ![apt-private](client/src/assets/icons/carbon/apt-private.svg) | `apt-private` | Open circle with an "R" inside | Private-use airports (`private`) |
| ![apt-helipad](client/src/assets/icons/carbon/apt-helipad.svg) | `apt-helipad` | Open circle with an "H" inside | Public, private, and military heliports/vertiports (`heliport`) |
| ![apt-seaplane](client/src/assets/icons/carbon/apt-seaplane.svg) | `apt-seaplane` | Anchor symbol inside ticked circle | Public and private seaplane bases (`seaplane`, `seaplane_private`) |
| ![apt-ultralight](client/src/assets/icons/carbon/apt-ultralight.svg) | `apt-ultralight` | Open circle with an "F" inside | Ultralight flightparks (`ultralight`) |
| ![apt-gliderport](client/src/assets/icons/carbon/apt-gliderport.svg) | `apt-gliderport` | Open circle with a "G" inside | Gliderports (`gliderport`) |
| ![apt-balloonport](client/src/assets/icons/carbon/apt-balloonport.svg) | `apt-balloonport` | Open circle with a "B" inside | Balloonports (`balloonport`) |

### Overlays + Variants

Coloring indicates whether airport is towered (cyan) or not (magenta).

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| — | `apt-fuel-ticks` | Small same-color tick marks sticking out at 12, 3, 6, and 9 o'clock | Baked directly into `apt-ifr-civil` and `apt-seaplane` |
| ![apt-beacon](client/src/assets/icons/carbon/apt-beacon.svg) | `apt-beacon` | Open 5-point star | Can be dynamically superimposed on base airport icons |

## 2. NAVAIDs

These icons indicate radio navigation aids.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![nav-vor](client/src/assets/icons/carbon/nav-vor.svg) | `nav-vor` | Hexagon with a central dot | VOR stations (`vor`) |
| ![nav-vortac](client/src/assets/icons/carbon/nav-vortac.svg) | `nav-vortac` | Hexagon with 3 solid rectangles attached | VORTAC stations (`vortac`) |
| ![nav-vordme](client/src/assets/icons/carbon/nav-vordme.svg) | `nav-vordme` | Hexagon inside a square | VOR-DME stations (`vordme`) |
| ![nav-dme](client/src/assets/icons/carbon/nav-dme.svg) | `nav-dme` | Square with a central dot | Standalone DME and ILS/DME (`dme`) |
| ![nav-tacan](client/src/assets/icons/carbon/nav-tacan.svg) | `nav-tacan` | Open triangle with 3 solid rectangles unioned | Military / standalone TACAN (`tacan`) |
| ![nav-ndb](client/src/assets/icons/carbon/nav-ndb.svg) | `nav-ndb` | Concentric circles with an inner dot array | NDB stations (`ndb`) |
| ![nav-ndb-dme](client/src/assets/icons/carbon/nav-ndb-dme.svg) | `nav-ndb-dme` | Concentric dot array inside a square | Variant icon (not yet emitted by pipeline) |
| ![nav-vhfor](client/src/assets/icons/carbon/nav-vhfor.svg) | `nav-vhfor` | Hexagon with outer tick marks | Variant icon (not yet emitted by pipeline) |
| <img src="client/src/assets/icons/nav-compass-rose.svg" width="32" height="32" alt="nav-compass-rose" /> | `nav-compass-rose` | Tick-marked outer ring oriented to magnetic north | Planned overlay centered beneath NAVAIDs |

## 3. Fixes, Waypoints & Routing

Icons representing specific coordinate points in the sky.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![fix-compulsory](client/src/assets/icons/carbon/fix-compulsory.svg) | `fix-compulsory` | Solid triangle | Combined named intersection & RNAV fixes (`compulsory`) |
| ![fix-non-compulsory](client/src/assets/icons/carbon/fix-non-compulsory.svg) | `fix-non-compulsory` | Open triangle | Named intersections, CNFs, and fallback fixes (`named`) |
| ![wpt-rnav-open](client/src/assets/icons/carbon/wpt-rnav-open.svg) | `wpt-rnav-open` | Open 4-point starburst | Fly-by RNAV waypoints (`rnav`) |
| ![wpt-rnav-solid](client/src/assets/icons/carbon/wpt-rnav-solid.svg) | `wpt-rnav-solid` | Solid 4-point starburst | Fly-over RNAV symbol; used as Settings legend badge |
| ![wpt-vfr-checkpoint](client/src/assets/icons/carbon/wpt-vfr-checkpoint.svg) | `wpt-vfr-checkpoint` | Pennant/Flag icon | VFR reporting points / checkpoints (`vfr`) |
| — | `pass-mountain` | Opposing curved brackets `)(` | Planned symbol for mountain passes |

## 4. Obstructions & Relief

Markers for hazards to flight.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![obs-minor](client/src/assets/icons/carbon/obs-minor.svg) | `obs-minor` | Upward pointing chevron with dot | Obstacle < 1000' AGL |
| ![obs-major](client/src/assets/icons/carbon/obs-major.svg) | `obs-major` | Tower/Eiffel-shape with dot | Obstacle ≥ 1000' AGL |
| ![obs-wind-turbine](client/src/assets/icons/carbon/obs-wind-turbine.svg) | `obs-wind-turbine` | Wind turbine icon | Wind turbines (`type == "WINDMILL"`) |

### Overlays + Variants

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![obs-minor-lit](client/src/assets/icons/carbon/obs-minor-lit.svg) | `obs-minor-lit` | Minor obstacle with radiating light rays | Red-lit obstacle < 1000' AGL (`lighting == "R"`) |
| ![obs-major-lit](client/src/assets/icons/carbon/obs-major-lit.svg) | `obs-major-lit` | Major obstacle with radiating light rays | Red-lit obstacle ≥ 1000' AGL (`lighting == "R"`) |
