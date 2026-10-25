// Sound effects, made on the fly with Web Audio: no sound files to load.
import { load, save } from './storage.js';

const saved = load();
let soundOn = saved.sound !== false;

let audio = null;

export function ac() {
  if (!soundOn) return null;
  if (!audio) {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (audio.state !== 'running') audio.resume().catch(() => {});
  return audio;
}

function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.2, freq = 1200, q = 1, at = 0, type = 'bandpass' } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + at;
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  putt(p) {
    noise(0.05, { vol: 0.25 + p * 0.3, freq: 2600, q: 2 });
    tone(950, 0.06, { vol: 0.12 + p * 0.1, type: 'triangle' });
  },
  hit(speed) {
    const v = Math.min(1, speed / 6);
    tone(180 + v * 120, 0.09, { vol: 0.08 + v * 0.25, type: 'triangle', slide: 0.6 });
    noise(0.04, { vol: 0.08 + v * 0.15, freq: 900, q: 1 });
  },
  cup() {
    tone(640, 0.12, { vol: 0.2, type: 'triangle', slide: 0.7 });
    noise(0.12, { vol: 0.2, freq: 1800, q: 3, at: 0.08 });
    tone(420, 0.18, { vol: 0.2, type: 'triangle', at: 0.15, slide: 0.8 });
  },
  bumper() {
    tone(880, 0.08, { vol: 0.16, type: 'square', slide: 1.5 });
    tone(1320, 0.1, { vol: 0.1, type: 'triangle', at: 0.04 });
  },
  warp() {
    tone(300, 0.35, { vol: 0.14, type: 'triangle', slide: 3 });
    tone(450, 0.3, { vol: 0.08, type: 'sine', at: 0.05, slide: 2.5 });
  },
  ice(speed) {
    noise(0.28, { vol: Math.min(0.08, 0.02 + speed * 0.012), freq: 6000, q: 0.7, type: 'highpass' });
  },
  firework() {
    noise(0.35, { vol: 0.12, freq: 900, q: 0.5, type: 'lowpass' });
    tone(1600 + Math.random() * 800, 0.25, { vol: 0.05, type: 'triangle', slide: 0.5 });
  },
  fall() {
    tone(500, 0.6, { vol: 0.14, type: 'triangle', slide: 0.25 });
  },
  splash() {
    noise(0.5, { vol: 0.35, freq: 700, q: 0.6, type: 'lowpass' });
    tone(300, 0.25, { vol: 0.08, slide: 0.4 });
  },
  cheer(level) {
    const notes = [523, 659, 784, 1047, 1319];
    const n = Math.min(notes.length, 2 + level);
    for (let i = 0; i < n; i++) tone(notes[i], 0.22, { vol: 0.14, type: 'triangle', at: i * 0.09 });
  },
};

export const soundIsOn = () => soundOn;

export function setSound(on) {
  soundOn = on;
  const data = load();
  data.sound = on;
  save(data);
}
