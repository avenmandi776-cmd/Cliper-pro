import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVerticalCropFilter,
  clampClipWindow,
  parseFfmpegProgressTime,
  parseResolution,
  validateStreamUrl,
} from './videoMath';

test('parseResolution maps 720x1280 and 480x854 correctly', () => {
  assert.deepEqual(parseResolution('720x1280'), { width: 720, height: 1280 });
  assert.deepEqual(parseResolution('480x854'), { width: 480, height: 854 });
});

test('clampClipWindow keeps clip within video duration bounds', () => {
  const res = clampClipWindow(40, 30, 50);
  assert.equal(res.start, 20);
  assert.equal(res.end, 50);
  assert.equal(res.duration, 30);
});

test('buildVerticalCropFilter creates 9:16 crop and blurred fit filtergraphs', () => {
  const centerCrop = buildVerticalCropFilter({
    mode: 'center',
    targetWidth: 720,
    targetHeight: 1280,
    focusXPercent: 50,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });
  assert.match(centerCrop, /crop=608:1080:656:0,scale=720:1280/);

  const fitBlur = buildVerticalCropFilter({
    mode: 'fit_blur',
    targetWidth: 480,
    targetHeight: 854,
    focusXPercent: 0,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });
  assert.match(fitBlur, /boxblur=18:4/);
  assert.match(fitBlur, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
});

test('validateStreamUrl detects YouTube Live URLs and blocks SSRF private addresses', () => {
  const yt = validateStreamUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt.valid, true);
  assert.equal(yt.kind, 'youtube_live');
  assert.equal(yt.youtubeVideoId, 'dQw4w9WgXcQ');

  const ytLive = validateStreamUrl('https://youtube.com/live/abc123XYZ');
  assert.equal(ytLive.valid, true);
  assert.equal(ytLive.kind, 'youtube_live');
  assert.equal(ytLive.youtubeVideoId, 'abc123XYZ');

  const ssrfLocal = validateStreamUrl('http://127.0.0.1:8080/stream.m3u8');
  assert.equal(ssrfLocal.valid, false);

  const ssrfMetadata = validateStreamUrl('http://169.254.169.254/latest/meta-data');
  assert.equal(ssrfMetadata.valid, false);

  const demo = validateStreamUrl('studio://demo-live');
  assert.equal(demo.valid, true);
  assert.equal(demo.kind, 'studio_demo');
});

test('parseFfmpegProgressTime extracts elapsed seconds from progress output', () => {
  assert.equal(parseFfmpegProgressTime('frame=120\nout_time_us=12500000\nspeed=2.1x'), 12.5);
  assert.equal(parseFfmpegProgressTime('frame=50 fps=30 time=00:01:05.50 bitrate=1000kbits/s'), 65.5);
});
