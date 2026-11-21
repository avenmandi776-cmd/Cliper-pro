import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAssTime,
  formatSrtTime,
  generateAss,
  generateSrt,
  hexToAssColor,
  resolveAssFontForLanguage,
  sliceTranscriptForClip,
} from './subtitles';
import type { SubtitleConfig, TranscriptSegment } from './types';

test('formatSrtTime formats seconds accurately with comma milliseconds', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(65.432), '00:01:05,432');
  assert.equal(formatSrtTime(3661.5), '01:01:01,500');
});

test('formatAssTime formats centiseconds accurately', () => {
  assert.equal(formatAssTime(0), '0:00:00.00');
  assert.equal(formatAssTime(12.34), '0:00:12.34');
});

test('hexToAssColor converts RGB hex to ASS BGR hex', () => {
  assert.equal(hexToAssColor('#FF8800'), '&H000088FF');
  assert.equal(hexToAssColor('#10B981'), '&H0081B910');
});

test('resolveAssFontForLanguage selects Indic scripts for Hindi and Bengali', () => {
  assert.equal(resolveAssFontForLanguage('DejaVu Sans', 'hi'), 'Noto Sans Devanagari');
  assert.equal(resolveAssFontForLanguage('DejaVu Sans', 'bn'), 'Noto Sans Bengali');
  assert.equal(resolveAssFontForLanguage('JetBrains Mono', 'en'), 'JetBrains Mono');
});

test('sliceTranscriptForClip shifts timestamps relative to clip start', () => {
  const segs: TranscriptSegment[] = [
    {
      id: 's1',
      start: 10,
      end: 15,
      text: 'This is a huge breakthrough',
      words: [
        { word: 'This', start: 10, end: 11 },
        { word: 'is', start: 11, end: 12 },
        { word: 'a', start: 12, end: 13 },
        { word: 'huge', start: 13, end: 14, important: true },
        { word: 'breakthrough', start: 14, end: 15, important: true },
      ],
    },
  ];
  const sliced = sliceTranscriptForClip(segs, 12, 16);
  assert.equal(sliced.length, 1);
  assert.equal(sliced[0].start, 0);
  assert.equal(sliced[0].end, 3);
  assert.equal(sliced[0].words[0].word, 'a');
  assert.equal(sliced[0].words[0].start, 0);
});

test('generateSrt and generateAss produce valid subtitle documents', () => {
  const segs: TranscriptSegment[] = [
    {
      id: 's1',
      start: 0,
      end: 2.5,
      text: 'Welcome to ClipGenius',
      words: [
        { word: 'Welcome', start: 0, end: 0.8 },
        { word: 'to', start: 0.8, end: 1.2 },
        { word: 'ClipGenius', start: 1.2, end: 2.5, important: true },
      ],
    },
  ];
  const srt = generateSrt(segs);
  assert.match(srt, /1\n00:00:00,000 --> 00:00:02,500\nWelcome to ClipGenius/);

  const config: SubtitleConfig = {
    enabled: true,
    language: 'en',
    stylePreset: 'viral_pop',
    fontFamily: 'DejaVu Sans',
    fontSize: 44,
    primaryColor: '#FFFFFF',
    highlightColor: '#FACC15',
    position: 'bottom',
    wordByWord: true,
  };
  const ass = generateAss(segs, config, '720x1280');
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00/);
  assert.match(ass, /CLIPGENIUS/);
});
