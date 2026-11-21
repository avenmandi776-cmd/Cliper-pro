import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  ClipDurationOption,
  LanguageCode,
  TranscriptSegment,
} from '../../shared/types';
import { synthesizeWordTimings } from '../../shared/subtitles';
import { clampClipWindow } from '../../shared/videoMath';
import { resolveSafeDataPath } from './store';

const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
]);

export function resolveSafeModel(requestedModel?: string): string {
  if (requestedModel && ALLOWED_MODELS.has(requestedModel)) {
    return requestedModel;
  }
  return 'gemini-4-hydrogen';
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your Gemini API key in Settings > Secrets to run AI transcription and highlight analysis.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function languageDisplayName(lang: LanguageCode): string {
  if (lang === 'hi') return 'Hindi (Devanagari script)';
  if (lang === 'bn') return 'Bengali (Bengali script)';
  return 'English';
}

export async function transcribeAudio(params: {
  audioPath: string;
  language: LanguageCode;
  durationSec: number;
  model: string;
}): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const safeAudioPath = resolveSafeDataPath(params.audioPath);

  // Optional Whisper-compatible HTTP speech-to-text endpoint if configured
  const whisperUrl = process.env.WHISPER_API_URL?.trim();
  if (whisperUrl) {
    const fileBuf = fs.readFileSync(safeAudioPath);
    const form = new FormData();
    form.append('file', new Blob([fileBuf], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', 'whisper-1');
    form.append('language', params.language);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const resp = await fetch(whisperUrl, { method: 'POST', body: form });
    if (!resp.ok) {
      throw new Error(`Whisper endpoint returned ${resp.status}: ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      text?: string;
      segments?: Array<{
        id?: number;
        start: number;
        end: number;
        text: string;
        words?: Array<{ word: string; start: number; end: number }>;
      }>;
    };
    const segments: TranscriptSegment[] = (json.segments ?? []).map((seg, i) => {
      const s: TranscriptSegment = {
        id: `seg_${i + 1}`,
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        words: (seg.words ?? []).map((w) => ({
          word: w.word.trim(),
          start: w.start,
          end: w.end,
        })),
      };
      if (s.words.length === 0) {
        s.words = synthesizeWordTimings(s);
      }
      return s;
    });
    return { text: json.text || segments.map((s) => s.text).join(' '), segments };
  }

  // Primary: Multimodal Gemini Speech-to-Text + Word-Level Timestamp Alignment
  const ai = getGeminiClient();
  const base64Audio = fs.readFileSync(safeAudioPath).toString('base64');
  const audioPart = {
    inlineData: {
      mimeType: 'audio/mp3',
      data: base64Audio,
    },
  };

  const analysisModel = resolveSafeModel(params.model);
  const structuredResp = await ai.models.generateContent({
    model: analysisModel,
    contents: {
      parts: [
        audioPart,
        {
          text: `Listen carefully to this audio (total duration ${params.durationSec.toFixed(1)}s) and transcribe all spoken dialogue accurately in ${languageDisplayName(params.language)}. Split into natural sequential spoken segments with accurate start/end seconds (0 to ${params.durationSec.toFixed(1)}), full segment text, and word-level start/end timings. Mark impactful or emotional words with important: true.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fullText: { type: Type.STRING },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                text: { type: Type.STRING },
                speaker: { type: Type.STRING },
                words: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      word: { type: Type.STRING },
                      start: { type: Type.NUMBER },
                      end: { type: Type.NUMBER },
                      important: { type: Type.BOOLEAN },
                    },
                    required: ['word', 'start', 'end'],
                  },
                },
              },
              required: ['start', 'end', 'text'],
            },
          },
        },
        required: ['segments'],
      },
    },
  });

  const rawJson = (structuredResp.text ?? '{}').trim();
  const parsed = JSON.parse(rawJson) as {
    fullText?: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
      speaker?: string;
      words?: Array<{ word: string; start: number; end: number; important?: boolean }>;
    }>;
  };
  const verbatimText = (parsed.fullText ?? '').trim();

  const segments: TranscriptSegment[] = (parsed.segments ?? []).map((seg, idx) => {
    const start = Math.max(0, Math.min(params.durationSec, Number(seg.start) || 0));
    const end = Math.max(start + 0.3, Math.min(params.durationSec, Number(seg.end) || start + 2));
    const item: TranscriptSegment = {
      id: `seg_${idx + 1}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text: seg.text.trim(),
      speaker: seg.speaker,
      words: (seg.words ?? []).map((w) => ({
        word: w.word.trim(),
        start: Number(Math.max(start, w.start).toFixed(2)),
        end: Number(Math.min(end, Math.max(w.start + 0.05, w.end)).toFixed(2)),
        important: Boolean(w.important),
      })),
    };
    if (item.words.length === 0) {
      item.words = synthesizeWordTimings(item);
    }
    return item;
  });

  return {
    text: verbatimText || segments.map((s) => s.text).join(' '),
    segments,
  };
}

export interface DetectedHighlight {
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  category: 'viral' | 'funny' | 'reaction' | 'insight';
  reason: string;
  title: string;
  description: string;
  hashtags: string[];
}

export async function analyzeHighlightsWithGemini(params: {
  transcript: TranscriptSegment[];
  videoTitle: string;
  durationSec: number;
  targetClipDuration: ClipDurationOption;
  language: LanguageCode;
  model: string;
}): Promise<{ summary: string; highlights: DetectedHighlight[] }> {
  const ai = getGeminiClient();
  const model = resolveSafeModel(params.model);

  const formattedTranscript = params.transcript
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`)
    .join('\n');

  const maxClips = params.durationSec < 25 ? 1 : params.durationSec < 60 ? 2 : 4;

  const response = await ai.models.generateContent({
    model,
    contents: `Analyze this video "${params.videoTitle}" (total length ${params.durationSec.toFixed(1)}s, language: ${languageDisplayName(params.language)}) and select up to ${maxClips} standout short-form clip moments of ~${params.targetClipDuration} seconds each.

Transcript:
${formattedTranscript || '(No speech detected — evaluate video length and segment cleanly.)'}

Identify:
- Viral hooks and surprising claims
- Exciting reactions or high-energy moments
- Funny moments or witty exchanges
- Important insights or actionable takeaways

For each highlight, provide:
- startTime (seconds) and endTime (seconds), targeting ~${params.targetClipDuration}s window within 0..${params.durationSec.toFixed(1)}
- score (integer 1 to 100)
- category ('viral' | 'funny' | 'reaction' | 'insight')
- reason (concise explanation of why this moment works)
- title (punchy short-form title)
- description (1-2 sentence social caption)
- hashtags (4-6 relevant hashtags starting with #)`,
    config: {
      systemInstruction:
        'You are an expert short-form video producer specializing in viral retention hooks for Reels, Shorts, and TikTok.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          highlights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                score: { type: Type.INTEGER },
                category: { type: Type.STRING },
                reason: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                hashtags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'startTime',
                'endTime',
                'score',
                'category',
                'reason',
                'title',
                'description',
                'hashtags',
              ],
            },
          },
        },
        required: ['summary', 'highlights'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    summary?: string;
    highlights?: Array<{
      startTime: number;
      endTime: number;
      score: number;
      category: string;
      reason: string;
      title: string;
      description: string;
      hashtags: string[];
    }>;
  };

  const validCats = new Set(['viral', 'funny', 'reaction', 'insight']);
  const highlights: DetectedHighlight[] = (parsed.highlights ?? []).slice(0, maxClips).map((h) => {
    const clamped = clampClipWindow(h.startTime, params.targetClipDuration, params.durationSec);
    return {
      startTime: clamped.start,
      endTime: clamped.end,
      duration: clamped.duration,
      score: Math.max(1, Math.min(100, Math.round(h.score || 75))),
      category: (validCats.has(h.category) ? h.category : 'viral') as DetectedHighlight['category'],
      reason: h.reason,
      title: h.title,
      description: h.description,
      hashtags: (h.hashtags ?? []).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    };
  });

  return {
    summary: parsed.summary || 'AI highlight analysis completed.',
    highlights,
  };
}

export async function correctCaptionsWithGemini(params: {
  segments: TranscriptSegment[];
  language: LanguageCode;
  model: string;
}): Promise<TranscriptSegment[]> {
  const ai = getGeminiClient();
  const model = resolveSafeModel(params.model);

  const response = await ai.models.generateContent({
    model,
    contents: `Proofread and correct transcription mistakes, punctuation, casing, and spelling in ${languageDisplayName(params.language)} for these subtitle segments. Keep exact ids, start, and end values untouched.\n\n${JSON.stringify(
      params.segments.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text }))
    )}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['id', 'text'],
            },
          },
        },
        required: ['segments'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    segments?: Array<{ id: string; text: string }>;
  };

  const mapById = new Map((parsed.segments ?? []).map((s) => [s.id, s.text]));
  return params.segments.map((seg) => {
    const corrected = mapById.get(seg.id)?.trim();
    if (!corrected) return seg;
    const updated: TranscriptSegment = {
      ...seg,
      text: corrected,
      words: [],
    };
    updated.words = synthesizeWordTimings(updated);
    return updated;
  });
}

export async function generateClipMetadataWithGemini(params: {
  transcriptText: string;
  currentTitle: string;
  language: LanguageCode;
  model: string;
}): Promise<{ title: string; description: string; hashtags: string[] }> {
  const ai = getGeminiClient();
  const model = resolveSafeModel(params.model);

  const response = await ai.models.generateContent({
    model,
    contents: `Generate an engaging short-form viral title, 2-sentence social description, and 5 hashtags in ${languageDisplayName(params.language)} for this video clip.\nOriginal title: ${params.currentTitle}\nTranscript: ${params.transcriptText || params.currentTitle}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'hashtags'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    title?: string;
    description?: string;
    hashtags?: string[];
  };

  return {
    title: parsed.title?.trim() || params.currentTitle,
    description: parsed.description?.trim() || '',
    hashtags: (parsed.hashtags ?? []).map((t) => (t.startsWith('#') ? t : `#${t}`)),
  };
}
