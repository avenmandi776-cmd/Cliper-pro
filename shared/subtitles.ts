import type {
  LanguageCode,
  ResolutionOption,
  SubtitleConfig,
  SubtitlePosition,
  TranscriptSegment,
  TranscriptWord,
} from './types';
import { parseResolution } from './videoMath';

export function formatSrtTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const normalizedMs = ms >= 1000 ? 999 : ms;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(normalizedMs).padStart(3, '0')}`;
}

export function formatAssTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const cleaned = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `&H${alphaHex}FFFFFF`;
  }
  const r = cleaned.slice(0, 2).toUpperCase();
  const g = cleaned.slice(2, 4).toUpperCase();
  const b = cleaned.slice(4, 6).toUpperCase();
  return `&H${alphaHex}${b}${g}${r}`;
}

export function resolveAssFontForLanguage(requestedFont: string, language: LanguageCode): string {
  if (language === 'hi') {
    return 'Noto Sans Devanagari';
  }
  if (language === 'bn') {
    return 'Noto Sans Bengali';
  }
  const allowedFonts = new Set([
    'DejaVu Sans',
    'Liberation Sans',
    'JetBrains Mono',
    'Noto Sans',
    'DejaVu Serif',
  ]);
  return allowedFonts.has(requestedFont) ? requestedFont : 'DejaVu Sans';
}

export function synthesizeWordTimings(segment: TranscriptSegment): TranscriptWord[] {
  if (segment.words && segment.words.length > 0) {
    return segment.words;
  }
  const tokens = segment.text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const duration = Math.max(0.25, segment.end - segment.start);
  const perWord = duration / tokens.length;

  return tokens.map((word, idx) => ({
    word,
    start: Number((segment.start + idx * perWord).toFixed(3)),
    end: Number((segment.start + (idx + 1) * perWord).toFixed(3)),
    important: word.length >= 7 || /[!?]$/.test(word),
  }));
}

export function sliceTranscriptForClip(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number
): TranscriptSegment[] {
  const sliced: TranscriptSegment[] = [];

  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) {
      continue;
    }
    const clampedStart = Math.max(seg.start, clipStart) - clipStart;
    const clampedEnd = Math.min(seg.end, clipEnd) - clipStart;
    if (clampedEnd - clampedStart < 0.08) continue;

    const words = synthesizeWordTimings(seg)
      .filter((w) => w.end > clipStart && w.start < clipEnd)
      .map((w) => ({
        ...w,
        start: Number(Math.max(0, w.start - clipStart).toFixed(3)),
        end: Number(Math.max(0.05, Math.min(clipEnd - clipStart, w.end - clipStart)).toFixed(3)),
      }));

    const text = words.length > 0 ? words.map((w) => w.word).join(' ') : seg.text;

    sliced.push({
      id: `${seg.id}_clip`,
      start: Number(clampedStart.toFixed(3)),
      end: Number(clampedEnd.toFixed(3)),
      text,
      speaker: seg.speaker,
      words,
    });
  }

  return sliced;
}

export function generateSrt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '';
  return (
    segments
      .map((seg, index) => {
        const start = formatSrtTime(seg.start);
        const end = formatSrtTime(Math.max(seg.start + 0.2, seg.end));
        return `${index + 1}\n${start} --> ${end}\n${seg.text.trim()}`;
      })
      .join('\n\n') + '\n'
  );
}

function getAssAlignmentAndMargin(position: SubtitlePosition, height: number): {
  alignment: number;
  marginV: number;
} {
  if (position === 'top') {
    return { alignment: 8, marginV: Math.round(height * 0.1) };
  }
  if (position === 'middle') {
    return { alignment: 5, marginV: 0 };
  }
  return { alignment: 2, marginV: Math.round(height * 0.14) };
}

function escapeAssText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

export function generateAss(
  segments: TranscriptSegment[],
  config: SubtitleConfig,
  resolution: ResolutionOption
): string {
  const { width, height } = parseResolution(resolution);
  const scaleFactor = width / 720;
  const fontSize = Math.round(Math.min(72, Math.max(20, config.fontSize)) * scaleFactor);
  const fontName = resolveAssFontForLanguage(config.fontFamily, config.language);
  const primaryAss = hexToAssColor(config.primaryColor, '00');
  const highlightAss = hexToAssColor(config.highlightColor, '00');
  const { alignment, marginV } = getAssAlignmentAndMargin(config.position, height);

  let borderStyle = 1;
  let outline = Math.max(2, Math.round(3 * scaleFactor));
  let shadow = Math.max(1, Math.round(2 * scaleFactor));
  let backColor = '&H80000000';
  let bold = 1;

  if (config.stylePreset === 'clean_minimal') {
    borderStyle = 3;
    outline = Math.max(4, Math.round(6 * scaleFactor));
    shadow = 0;
    backColor = '&H99090B0F';
    bold = 0;
  } else if (config.stylePreset === 'karaoke_glow') {
    borderStyle = 1;
    outline = Math.max(2, Math.round(4 * scaleFactor));
    shadow = Math.max(2, Math.round(3 * scaleFactor));
    backColor = '&H66000000';
    bold = 1;
  } else if (config.stylePreset === 'editorial_classic') {
    borderStyle = 1;
    outline = Math.max(1, Math.round(2 * scaleFactor));
    shadow = Math.max(2, Math.round(2 * scaleFactor));
    backColor = '&H80000000';
    bold = 0;
  }

  const header = `[Script Info]
Title: ClipGenius AI Captions
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryAss},${highlightAss},&H00090B0F,${backColor},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines: string[] = [];

  for (const seg of segments) {
    const words = synthesizeWordTimings(seg);
    if (words.length === 0) continue;

    if (!config.wordByWord) {
      const startStr = formatAssTime(seg.start);
      const endStr = formatAssTime(Math.max(seg.start + 0.2, seg.end));
      const rendered = words
        .map((w) => {
          const safeWord = escapeAssText(w.word);
          return w.important ? `{\\c${highlightAss}}${safeWord}{\\c${primaryAss}}` : safeWord;
        })
        .join(' ');
      dialogueLines.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${rendered}`);
      continue;
    }

    // Group words into crisp 3-5 word chunks for vertical 9:16 readability
    const chunkSize = 4;
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize);
      for (let activeIdx = 0; activeIdx < chunk.length; activeIdx++) {
        const activeWord = chunk[activeIdx];
        const wStart = activeWord.start;
        const wEnd =
          activeIdx < chunk.length - 1
            ? Math.max(activeWord.end, chunk[activeIdx + 1].start)
            : activeWord.end;

        if (wEnd - wStart <= 0.02) continue;

        const lineText = chunk
          .map((w, idx) => {
            const safe = escapeAssText(
              config.stylePreset === 'viral_pop' ? w.word.toUpperCase() : w.word
            );
            if (idx === activeIdx) {
              return `{\\c${highlightAss}\\fscx108\\fscy108}${safe}{\\c${primaryAss}\\fscx100\\fscy100}`;
            }
            if (w.important) {
              return `{\\u1}${safe}{\\u0}`;
            }
            return safe;
          })
          .join(' ');

        dialogueLines.push(
          `Dialogue: 0,${formatAssTime(wStart)},${formatAssTime(wEnd)},Default,,0,0,0,,${lineText}`
        );
      }
    }
  }

  return header + dialogueLines.join('\n') + '\n';
}
