import { Geometry, Model } from "@luma.gl/engine";
import {
	color,
	gouraudMaterial,
	Layer,
	type LayerProps,
	picking,
	project32,
	type SolidPolygonLayerProps,
	type UpdateParameters,
} from "deck.gl";
import type {
	AirspaceWallBinaryData,
	RgbaFloatTuple,
} from "../utils/airspaces3d";

const airspaceWallUniforms = {
	name: "airspaceWall",
	source: "",
	vs: `\
layout(std140) uniform airspaceWallUniforms {
  vec4 colorB;
  vec4 colorC;
  vec4 colorD;
  vec4 colorSua;
  vec4 colorTrsa;
  float visibleMask;
  float terrainScale;
} airspaceWall;
`,
	fs: `\
layout(std140) uniform airspaceWallUniforms {
  vec4 colorB;
  vec4 colorC;
  vec4 colorD;
  vec4 colorSua;
  vec4 colorTrsa;
  float visibleMask;
  float terrainScale;
} airspaceWall;
`,
	uniformTypes: {
		colorB: "vec4<f32>",
		colorC: "vec4<f32>",
		colorD: "vec4<f32>",
		colorSua: "vec4<f32>",
		colorTrsa: "vec4<f32>",
		visibleMask: "f32",
		terrainScale: "f32",
	},
} as const;

const vs = `\
#version 300 es
#define SHADER_NAME airspace-wall-layer-vertex-shader

in vec2 positions;
in vec3 instanceSourcePositions;
in vec3 instanceSourcePositions64Low;
in vec3 instanceTargetPositions;
in vec3 instanceTargetPositions64Low;
in float instanceElevations;
in float instanceMasks;
in float instanceSourceTerrain;
in float instanceTargetTerrain;
in float instanceAglFlags;

out vec4 vColor;

vec3 project_offset_normal(vec3 vector) {
  if (project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT ||
    project.coordinateSystem == COORDINATE_SYSTEM_LNGLAT_OFFSETS) {
    return normalize(vector * project.commonUnitsPerWorldUnit);
  }
  return project_normal(vector);
}

vec4 pickWallColor(int activeMask) {
  if ((activeMask & 1) != 0) return airspaceWall.colorB;
  if ((activeMask & 2) != 0) return airspaceWall.colorC;
  if ((activeMask & 4) != 0) return airspaceWall.colorD;
  if ((activeMask & 8) != 0) return airspaceWall.colorSua;
  return airspaceWall.colorTrsa;
}

void main(void) {
  int mask = int(instanceMasks + 0.5);
  int visible = int(airspaceWall.visibleMask + 0.5);
  int activeMask = mask & visible;
  if (activeMask == 0) {
    gl_Position = vec4(0.0);
    vColor = vec4(0.0);
    return;
  }

  vec3 pos = mix(instanceSourcePositions, instanceTargetPositions, positions.x);
  vec3 pos64Low = mix(instanceSourcePositions64Low, instanceTargetPositions64Low, positions.x);
  int agl = int(instanceAglFlags + 0.5);
  float terrainZ = mix(instanceSourceTerrain, instanceTargetTerrain, positions.x) * airspaceWall.terrainScale;
  float z0Eff = instanceSourcePositions.z + ((agl & 1) != 0 ? terrainZ : 0.0);
  float z1Eff = (instanceSourcePositions.z + instanceElevations) + ((agl & 2) != 0 ? terrainZ : 0.0);
  pos.z = mix(z0Eff, max(z1Eff, z0Eff), positions.y);

  geometry.worldPosition = pos;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();

  gl_Position = project_position_to_clipspace(pos, pos64Low, vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vec3 rawNormal = vec3(
    instanceSourcePositions.y - instanceTargetPositions.y +
      (instanceSourcePositions64Low.y - instanceTargetPositions64Low.y),
    instanceTargetPositions.x - instanceSourcePositions.x +
      (instanceTargetPositions64Low.x - instanceTargetPositions64Low.x),
    0.0
  );
  vec3 normal = dot(rawNormal, rawNormal) > 0.0
    ? project_offset_normal(rawNormal)
    : vec3(0.0, 0.0, 1.0);
  vec3 viewDir = project.cameraPosition - geometry.position.xyz;
  if (dot(normal, viewDir) < 0.0) {
    normal = -normal;
  }
  geometry.normal = normal;

  vec4 wallColor = pickWallColor(activeMask);
  vec3 lightColor = lighting_getLightColor(
    wallColor.rgb,
    project.cameraPosition,
    geometry.position.xyz,
    geometry.normal
  );
  vColor = vec4(lightColor, wallColor.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;

const fs = `\
#version 300 es
#define SHADER_NAME airspace-wall-layer-fragment-shader
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main(void) {
  fragColor = vColor;
  geometry.uv = vec2(0.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

export interface AirspaceWallPalette {
	colorB: RgbaFloatTuple;
	colorC: RgbaFloatTuple;
	colorD: RgbaFloatTuple;
	colorSua: RgbaFloatTuple;
	colorTrsa: RgbaFloatTuple;
}

type _AirspaceWallLayerProps = {
	data: AirspaceWallBinaryData;
	visibleMask: number;
	terrainScale: number;
	palette: AirspaceWallPalette;
	material?: SolidPolygonLayerProps["material"];
};

export type AirspaceWallLayerProps = _AirspaceWallLayerProps & LayerProps;

const DEFAULT_RGBA: RgbaFloatTuple = [0.6, 0.6, 0.6, 35 / 255];

const defaultProps: typeof Layer.defaultProps = {
	visibleMask: 31,
	terrainScale: 0,
	palette: {
		colorB: DEFAULT_RGBA,
		colorC: DEFAULT_RGBA,
		colorD: DEFAULT_RGBA,
		colorSua: DEFAULT_RGBA,
		colorTrsa: DEFAULT_RGBA,
	},
	material: true,
};

export class AirspaceWallLayer extends Layer<
	Required<_AirspaceWallLayerProps>
> {
	static layerName = "AirspaceWallLayer";
	static defaultProps = defaultProps;

	declare state: {
		model?: Model;
	};

	get wrapLongitude(): boolean {
		return false;
	}

	getShaders() {
		return super.getShaders({
			vs,
			fs,
			modules: [
				project32,
				color,
				gouraudMaterial,
				picking,
				airspaceWallUniforms,
			],
		});
	}

	getBounds(): [number[], number[]] | null {
		return (
			this.getAttributeManager()?.getBounds([
				"instanceSourcePositions",
				"instanceTargetPositions",
			]) ?? null
		);
	}

	initializeState(): void {
		const attributeManager = this.getAttributeManager();
		if (!attributeManager) return;

		attributeManager.addInstanced({
			instanceSourcePositions: {
				size: 3,
				type: "float64",
				fp64: this.use64bitPositions(),
				accessor: "instanceSourcePositions",
			},
			instanceTargetPositions: {
				size: 3,
				type: "float64",
				fp64: this.use64bitPositions(),
				accessor: "instanceTargetPositions",
			},
			instanceElevations: {
				size: 1,
				type: "float32",
				accessor: "instanceElevations",
			},
			instanceMasks: {
				size: 1,
				type: "float32",
				accessor: "instanceMasks",
			},
			instanceSourceTerrain: {
				size: 1,
				type: "float32",
				accessor: "instanceSourceTerrain",
			},
			instanceTargetTerrain: {
				size: 1,
				type: "float32",
				accessor: "instanceTargetTerrain",
			},
			instanceAglFlags: {
				size: 1,
				type: "float32",
				accessor: "instanceAglFlags",
			},
		});
	}

	updateState(params: UpdateParameters<this>): void {
		super.updateState(params);
		const { changeFlags } = params;
		if (changeFlags.extensionsChanged || !this.state.model) {
			this.state.model?.destroy();
			this.setState({ model: this._getModel() });
			this.getAttributeManager()?.invalidateAll();
		}
	}

	draw(): void {
		const { model } = this.state;
		if (!model) return;
		const count = this.getNumInstances();
		if (count <= 0) return;

		const { palette, visibleMask, terrainScale } = this.props;
		model.setInstanceCount(count);
		model.shaderInputs.setProps({
			airspaceWall: {
				colorB: palette.colorB,
				colorC: palette.colorC,
				colorD: palette.colorD,
				colorSua: palette.colorSua,
				colorTrsa: palette.colorTrsa,
				visibleMask,
				terrainScale,
			},
		});
		model.draw(this.context.renderPass);
	}

	private _getModel(): Model {
		const bufferLayout = this.getAttributeManager()!.getBufferLayouts();
		return new Model(this.context.device, {
			...this.getShaders(),
			id: this.props.id,
			bufferLayout,
			geometry: new Geometry({
				topology: "triangle-strip",
				attributes: {
					positions: {
						size: 2,
						value: new Float32Array([1, 0, 0, 0, 1, 1, 0, 1]),
					},
				},
			}),
			isInstanced: true,
		});
	}
}
