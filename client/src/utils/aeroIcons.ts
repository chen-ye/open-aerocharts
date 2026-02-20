import { Map } from 'maplibre-gl';

const iconGlob = import.meta.glob('../assets/icons/*.svg', { as: 'raw', eager: true });

export const addAeroIcons = (map: Map) => {
  const loadIcon = (id: string, svgContent: string) => {
    if (map.hasImage(id)) return;
    const img = new Image(24, 24);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      // Small race condition check in case multiple loads fire
      if (!map.hasImage(id)) {
        map.addImage(id, img);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  for (const [path, svgContent] of Object.entries(iconGlob)) {
    // Extract base name without extension, e.g. 'airport-magenta'
    const id = path.split('/').pop()?.replace('.svg', '');
    if (id && typeof svgContent === 'string') {
      loadIcon(id, svgContent);
    }
  }
};
