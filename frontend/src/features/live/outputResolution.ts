export type OutputResolution = {
  id: "360p" | "540p" | "720p" | "1080p";
  width: number;
  height: number;
  label: string;
};

export const OUTPUT_RESOLUTIONS: OutputResolution[] = [
  { id: "360p", width: 360, height: 640, label: "流畅 360 × 640" },
  { id: "540p", width: 540, height: 960, label: "标清 540 × 960" },
  { id: "720p", width: 720, height: 1280, label: "高清 720 × 1280" },
  { id: "1080p", width: 1080, height: 1920, label: "全高清 1080 × 1920" }
];

export const DEFAULT_OUTPUT_RESOLUTION = OUTPUT_RESOLUTIONS[2];

export function outputResolutionById(id: string | null): OutputResolution {
  return (
    OUTPUT_RESOLUTIONS.find((resolution) => resolution.id === id) ??
    DEFAULT_OUTPUT_RESOLUTION
  );
}
