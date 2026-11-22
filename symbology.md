# Aeronautical Symbols

## 1. Airports & Heliports

These are the core point markers for landing facilities.

| Asset Name | Visual Description | Notes |
| :--- | :--- | :--- |
| `apt-civil-unpaved` | Open circle | Public unpaved civil airports (`civil_soft`) |
| `apt-ifr-civil` | Open circle with 12, 3, 6, and 9 o'clock ticks | Public paved civil airports (`civil_hard`); world-space runway polygons render underneath at high zoom |
| `apt-ifr-military` | Double concentric circle with central dot | Military airports (`military`); `apt-ifr-military-civil` variant also available |
| `apt-private` | Open circle with an "R" inside | Private-use airports (`private`) |
| `apt-helipad` | Open circle with an "H" inside | Public, private, and military heliports/vertiports (`heliport`) |
| `apt-seaplane` | Anchor symbol inside ticked circle | Public and private seaplane bases (`seaplane`, `seaplane_private`) |
| `apt-ultralight` | Open circle with an "F" inside | Ultralight flightparks (`ultralight`) |
| `apt-gliderport` | Open circle with a "G" inside | Gliderports (`gliderport`) |
| `apt-balloonport` | Open circle with a "B" inside | Balloonports (`balloonport`) |

### Overlays + Variants

Coloring indicates whether airport is towered (cyan) or not (magenta).

| apt-fuel-ticks | Small same-color tick marks sticking out at 12, 3, 6, and 9 o'clock |
Should be variant icons derived from the base icons |

| apt-beacon | Open 5-point star | Can be dynamically superimposed on base airport icons |

## 2. NAVAIDs

These icons indicate radio navigation aids.

| Asset Name | Visual Description | Notes |

| :--- | :--- | :--- |

| nav-vor | Hexagon with a central dot | |

| nav-vortac | Hexagon with 3 solid rectangles attached | |

| nav-vor-dme | Hexagon inside a square | |

| nav-dme | Square with a central dot | |

| nav-tacan | Open triangle with 3 solid rectangles unioned | Mostly military |

| nav-ndb | Concentric circles with an inner dot array | |

| nav-compass-rose | Tick-marked outer ring oriented to magnetic north | Often
rendered as an icon centered beneath the NAVAID |

## 3. Fixes, Waypoints & Routing

Icons representing specific coordinate points in the sky.

| Asset Name | Visual Description | Notes |

| :--- | :--- | :--- |

| fix-compulsory | Solid triangle | |

| fix-non-compulsory | Open triangle | |

| wpt-rnav-solid | Solid 4-point starburst | |

| wpt-rnav-open | Open 4-point starburst | |

| wpt-vfr-checkpoint | Pennant/Flag icon | |

| pass-mountain | Opposing curved brackets )( | Identifies mountain passes |

## 4. Obstructions & Relief

Markers for hazards to flight.

| Asset Name | Visual Description | Notes |

| :--- | :--- | :--- |

| obs-minor | Upward pointing chevron with dot | Obstacle < 1000' AGL |

| obs-major | Tower/Eiffel-shape with dot | Obstacle ≥ 1000' AGL |

| obs-wind-turbine | Wind turbine icon | |

### Overlays + Variants

| obs-lighted | Radiating light rays | Placed on top of standard
obstacle icons to indicate high-intensity lighting |
