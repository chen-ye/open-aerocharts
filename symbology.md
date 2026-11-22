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
| ![apt-fuel-ticks](client/src/assets/icons/apt-fuel-ticks.svg) | `apt-fuel-ticks` | Small same-color tick marks sticking out at 12, 3, 6, and 9 o'clock | Legacy overlay; variant icons incorporate ticks directly |
| ![apt-beacon](client/src/assets/icons/carbon/apt-beacon.svg) | `apt-beacon` | Open 5-point star | Can be dynamically superimposed on base airport icons |

## 2. NAVAIDs

These icons indicate radio navigation aids.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![nav-vor](client/src/assets/icons/carbon/nav-vor.svg) | `nav-vor` | Hexagon with a central dot | |
| ![nav-vortac](client/src/assets/icons/carbon/nav-vortac.svg) | `nav-vortac` | Hexagon with 3 solid rectangles attached | |
| ![nav-vordme](client/src/assets/icons/carbon/nav-vordme.svg) | `nav-vordme` | Hexagon inside a square | |
| ![nav-dme](client/src/assets/icons/carbon/nav-dme.svg) | `nav-dme` | Square with a central dot | |
| ![nav-tacan](client/src/assets/icons/carbon/nav-tacan.svg) | `nav-tacan` | Open triangle with 3 solid rectangles unioned | Mostly military |
| ![nav-ndb](client/src/assets/icons/carbon/nav-ndb.svg) | `nav-ndb` | Concentric circles with an inner dot array | |
| ![nav-ndb-dme](client/src/assets/icons/carbon/nav-ndb-dme.svg) | `nav-ndb-dme` | Concentric dot array inside a square | |
| ![nav-vhfor](client/src/assets/icons/carbon/nav-vhfor.svg) | `nav-vhfor` | Hexagon with outer tick marks | |
| <img src="client/src/assets/icons/nav-compass-rose.svg" width="32" height="32" alt="nav-compass-rose" /> | `nav-compass-rose` | Tick-marked outer ring oriented to magnetic north | Often rendered as an icon centered beneath the NAVAID |

## 3. Fixes, Waypoints & Routing

Icons representing specific coordinate points in the sky and VFR routing elements.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![fix-compulsory](client/src/assets/icons/carbon/fix-compulsory.svg) | `fix-compulsory` | Solid triangle | |
| ![fix-non-compulsory](client/src/assets/icons/carbon/fix-non-compulsory.svg) | `fix-non-compulsory` | Open triangle | |
| ![wpt-rnav-solid](client/src/assets/icons/carbon/wpt-rnav-solid.svg) | `wpt-rnav-solid` | Solid 4-point starburst | |
| ![wpt-rnav-open](client/src/assets/icons/carbon/wpt-rnav-open.svg) | `wpt-rnav-open` | Open 4-point starburst | |
| ![wpt-vfr-checkpoint](client/src/assets/icons/carbon/wpt-vfr-checkpoint.svg) | `wpt-vfr-checkpoint` | FAA crimson/magenta pennant/flag icon | `VP*` VFR waypoints (NASR `FIX_BASE.csv`); sectional-charted IFR fixes fall back to `fix-compulsory` / `fix-non-compulsory` when IFR Waypoints are hidden |
| ![pass-mountain](client/src/assets/icons/carbon/pass-mountain.svg) | `pass-mountain` | Brown opposing curved brackets `)(` + elevation label (ft) | Identifies mountain passes |

### Military Training Routes (`IR` / `VR` / `SR`)

| Feature | Representation | Visual Description | Notes |
| :--- | :--- | :--- | :--- |
| **Military Training Routes** (`IR` / `VR` / `SR`) | Line + corridor polygon + label | Centerline with translucent width corridor and route/altitude labels | Instrument (`IR`), Visual (`VR`), and Slow Speed Low Altitude (`SR`) routes from ADDS `MTRSegment` + NASR `MTR_BASE`/`MTR_PT` |

## 4. Obstructions & Relief

Markers for hazards to flight.

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![obs-minor](client/src/assets/icons/carbon/obs-minor.svg) | `obs-minor` | Upward pointing chevron with dot | Obstacle < 1000' AGL |
| ![obs-major](client/src/assets/icons/carbon/obs-major.svg) | `obs-major` | Tower/Eiffel-shape with dot | Obstacle ≥ 1000' AGL |
| ![obs-wind-turbine](client/src/assets/icons/carbon/obs-wind-turbine.svg) | `obs-wind-turbine` | Wind turbine icon | |
| ![pat-wind-farm](client/src/assets/icons/pat-wind-farm.svg) | `pat-wind-farm` | Hatched polygon + outline + FAA MSL/AGL height label | Wind turbine clusters (USGS USWTDB 5 km AEQD + FAA DOF `WINDMILL`) |

### Overlays + Variants

| Icon | Asset Name | Visual Description | Notes |
| :---: | :--- | :--- | :--- |
| ![obs-minor-lit](client/src/assets/icons/carbon/obs-minor-lit.svg) | `obs-minor-lit` | Minor obstacle with radiating light rays | Lighted obstacle < 1000' AGL |
| ![obs-major-lit](client/src/assets/icons/carbon/obs-major-lit.svg) | `obs-major-lit` | Major obstacle with radiating light rays | Lighted obstacle ≥ 1000' AGL |
| ![obs-lighted-mod](client/src/assets/icons/obs-lighted-mod.svg) | `obs-lighted-mod` | Radiating light rays | Legacy overlay placed on top of standard obstacle icons |

## 5. Enroute Grid & Infrastructure

Vector-rendered grid overlays and linear infrastructure hazards.

| Feature | Visual Description | Notes |
| :--- | :--- | :--- |
| **Power Transmission Lines** | Dashed bronze/amber lines | Overhead lines `>= 115 kV` (HIFLD), voltage-tiered at `z6`/`z7`/`z9` |
| **Grid MORA** | `1° × 1°` latitude/longitude grid with Jeppesen two-tone split labels: teal (`< 14,000 ft`) / crimson (`>= 14,000 ft`) and superscripted hundreds digit | Minimum Off-Route Altitude derived from CIFP `AS` records (`enroute.pmtiles`) |
