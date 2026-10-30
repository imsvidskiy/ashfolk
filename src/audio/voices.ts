export const ROLLOFF = 1;

export interface VoiceWeight {
  readonly loudness: number;
  readonly priority: number;
}

export function heardLoudness(volume: number, referenceDistance: number, distance: number): number {
  if (referenceDistance <= 0) {
    return volume;
  }

  const beyond = Math.max(distance, referenceDistance) - referenceDistance;

  return (volume * referenceDistance) / (referenceDistance + ROLLOFF * beyond);
}

function weightOf(voice: VoiceWeight): number {
  return (voice.priority + 1) * voice.loudness;
}

export function voiceToReplace(voices: readonly VoiceWeight[], incoming: VoiceWeight, limit: number): number {
  if (voices.length < limit) {
    return voices.length;
  }

  let weakest = -1;
  let weakestWeight = weightOf(incoming);

  for (const [index, voice] of voices.entries()) {
    const weight = weightOf(voice);

    if (weight < weakestWeight) {
      weakest = index;
      weakestWeight = weight;
    }
  }

  return weakest;
}
