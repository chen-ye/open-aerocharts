import { Map } from 'maplibre-gl';
import { crimson, cyan, indigo, plum, brown, teal } from '@radix-ui/colors';


const iconGlob = import.meta.glob('../assets/icons/carbon/*.svg', { as: 'raw', eager: true });

const colorMap = {
  'apt-ifr-civil': crimson.crimson9,
  'apt-ifr-military': crimson.crimson9,
  'apt-ifr-military-civil': crimson.crimson9,
  'apt-ifr-heliport': crimson.crimson9,
  'apt-ifr-seaplane': crimson.crimson9,
  'apt-ifr-ultralight': crimson.crimson9,
  'apt-private': crimson.crimson9,
  'apt-helipad': crimson.crimson9,
  'fix-compulsory': indigo.indigo9,
  'fix-non-compulsory': indigo.indigo9,
  'wpt-rnav-open': indigo.indigo9,
  'wpt-rnav-solid': indigo.indigo9,
  'wpt-vfr-checkpoint': indigo.indigo9,
  'nav-vor': indigo.indigo9,
  'nav-vortac': indigo.indigo9,
  'nav-vordme': indigo.indigo9,
  'nav-tacan': teal.teal9,
  'nav-dme': teal.teal9,
  'nav-ndb-dme': brown.brown9,
  'nav-ndb': brown.brown9,
  'nav-vhfor': indigo.indigo9,
  'obs-major': plum.plum9,
  'obs-minor': plum.plum9,
  'obs-wind-turbine': plum.plum9,
  'obs-major-lit': plum.plum9,
  'obs-minor-lit': plum.plum9,
}

/**
 * Load all aeronautical SVG icons into the map with a halo outline effect.
 * @param map - MapLibre map instance
 * @param haloColor - CSS color for the halo outline (e.g. '#ffffff' for light maps, '#1a1a2e' for dark maps)
 * @param haloOpacity - Opacity of the halo (0-1)
 */
export const addAeroIcons = (map: Map, haloColor = '#ffffff', haloOpacity = 0.95) => {
  const loadIcon = (id: string, svgContent: string) => {
    // Inject the halo filter into the SVG content
    let finalSvg = svgContent;
    const svgMatch = svgContent.match(/<svg[^>]*>/);
    if (svgMatch) {
      const svgStart = svgMatch[0];
      const svgTagEnd = svgContent.indexOf(svgStart) + svgStart.length;

      const filterDef = `
        <defs>
          <filter id="icon-halo" x="-50%" y="-50%" width="200%" height="200%">
            <feMorphology in="SourceAlpha" operator="dilate" radius="1" result="dilated"/>
            <feFlood flood-color="${haloColor}" flood-opacity="${haloOpacity}" result="haloColor"/>
            <feComposite in="haloColor" in2="dilated" operator="in" result="halo"/>
            <feMerge>
              <feMergeNode in="halo"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#icon-halo)">
      `;
      finalSvg = svgContent.slice(0, svgTagEnd) + filterDef + svgContent.slice(svgTagEnd).replace(/<\/svg>\s*$/, '</g></svg>');
    }
    const color = colorMap[id as keyof typeof colorMap] ?? indigo.indigo9;
    const finalColoredSvg = finalSvg.replace(/fill="currentColor"/g, `fill="${color}"`).replace(/stroke="currentColor"/g, `stroke="${color}"`);

    const img = new Image(32, 32);
    const blob = new Blob([finalColoredSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      // Remove existing image if present (for theme switches)
      if (map.hasImage(id)) {
        map.removeImage(id);
      }
      map.addImage(id, img);
      URL.revokeObjectURL(url);
    };
    img.src = url;

    // Generate Cyan Variant for Flight Plan
    const cyanIds = [
      'fix-compulsory',
      'fix-non-compulsory',
      'nav-vor',
      'nav-vortac',
      'nav-vordme',
      'nav-tacan',
      'nav-dme',
      'nav-ndb-dme',
      'nav-ndb',
      'apt-ifr-civil',
      'apt-civil-paved-small'
    ];
    if (cyanIds.includes(id)) {
      // Replace blacks/grays or currentColor with Cyan 9 (#00A2C7)
      // Note: Since we normalized to currentColor, we should replace fill="currentColor"
      const hex = cyan.cyan9;
      const cyanSvg = finalSvg.replace(/stroke="[^"]*"/g, `stroke="${hex}"`)
                            .replace(/fill="[^"]*"/g, `fill="${hex}"`)
                            .replace(/fill="currentColor"/g, `fill="${hex}"`)
                            .replace(/stroke="currentColor"/g, `stroke="${hex}"`);

      const imgCyan = new Image(32, 32);
      const blobCyan = new Blob([cyanSvg], { type: 'image/svg+xml;charset=utf-8' });
      const urlCyan = URL.createObjectURL(blobCyan);
      imgCyan.onload = () => {
        const cyanId = `${id}-cyan`;
        if (map.hasImage(cyanId)) {
          map.removeImage(cyanId);
        }
        map.addImage(cyanId, imgCyan);
        URL.revokeObjectURL(urlCyan);
      };
      imgCyan.src = urlCyan;
    }
  };

  for (const [path, svgContent] of Object.entries(iconGlob)) {
    const id = path.split('/').pop()?.replace('.svg', '');
    if (id && typeof svgContent === 'string') {
      loadIcon(id, svgContent);
    }
  }
};
