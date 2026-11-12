// Minimal ambient module declaration for the Node-only `sherpa-onnx` package,
// which ships no TypeScript types. `any` is confined to this file.
declare module "sherpa-onnx" {
  export interface SherpaOfflineTtsConfig {
    [key: string]: unknown;
  }
  export interface SherpaGeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }
  export interface SherpaOfflineTts {
    generate(input: { text: string; sid?: number; speed?: number }): SherpaGeneratedAudio;
  }
  export function createOfflineTts(config: any): SherpaOfflineTts;
}
