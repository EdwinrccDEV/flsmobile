/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @ts-ignore
import * as lamejs from 'lamejs';

export interface AudioTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  offset: number; // in seconds (where it starts in the timeline)
  trimStart: number; // seconds to skip from the beginning of the buffer
  duration: number; // visible duration in seconds
  volume: number; // 0 to 1
  muted: boolean;
}

export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferWav = new ArrayBuffer(length);
  const view = new DataView(bufferWav);
  const channels = [];
  let i, sample, pos = 0;

  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };
  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - 44);

  for (i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  for (i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      sample = Math.max(-1, Math.min(1, channels[ch][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
  }
  return new Blob([bufferWav], { type: 'audio/wav' });
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

export async function convertToMp3(renderedBuffer: AudioBuffer, bitrate: number = 128): Promise<Blob> {
  const channels = 2;
  // @ts-ignore
  const Lame = lamejs.default || lamejs;
  const mp3encoder = new Lame.Mp3Encoder(channels, renderedBuffer.sampleRate, bitrate);
  const left = renderedBuffer.getChannelData(0);
  const right = renderedBuffer.numberOfChannels > 1 ? renderedBuffer.getChannelData(1) : left;
  const blockSize = 1152;
  const mp3Data = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const l = floatTo16BitPCM(left.subarray(i, i + blockSize));
    const r = floatTo16BitPCM(right.subarray(i, i + blockSize));
    const mp3buf = mp3encoder.encodeBuffer(l, r);
    if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
  }
  const end = mp3encoder.flush();
  if (end.length > 0) mp3Data.push(new Int8Array(end));
  return new Blob(mp3Data, { type: 'audio/mp3' });
}

export function drawWaveform(buffer: AudioBuffer, canvas: HTMLCanvasElement, color: string = '#4facfe') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const width = canvas.width;
  const height = canvas.height;
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  
  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[(i * step) + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    const y = (1 + min) * (height / 2);
    const h = Math.max(1, (max - min) * (height / 2));
    ctx.fillRect(i, y, 1, h);
  }
}
