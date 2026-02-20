import { Map } from 'maplibre-gl';

const iconGlob = import.meta.glob('../assets/icons/*.svg', { as: 'raw', eager: true });

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

    const img = new Image(32, 32);
    const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });
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
  };

  for (const [path, svgContent] of Object.entries(iconGlob)) {
    const id = path.split('/').pop()?.replace('.svg', '');
    if (id && typeof svgContent === 'string') {
      loadIcon(id, svgContent);
    }
  }
};
