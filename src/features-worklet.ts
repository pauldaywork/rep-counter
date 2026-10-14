import { FeatureExtractor } from "./features";

// AudioWorkletGlobalScope globals, which TypeScript's DOM lib does not declare.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class FeaturesProcessor extends AudioWorkletProcessor {
  private readonly extractor = new FeatureExtractor(sampleRate);

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const frame of this.extractor.push(channel)) this.port.postMessage(frame);
    }
    return true;
  }
}

registerProcessor("features", FeaturesProcessor);
