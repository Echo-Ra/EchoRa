import { Ytdl } from "@distube/ytdl-core";
import { logger } from "../../utils/logger.js";
import { resolveYouTubeVideoId } from "./youtubeResolver.js";
import { resolveTrackPreview } from "../spotify/previewEnricher.js";

const ytdl = new Ytdl();

interface CachedAudioUrl {
  url: string;
  expiresAt: number;
}
const audioUrlCache = new Map<string, CachedAudioUrl>();

/**
 * Selects the highest quality, most browser-compatible audio format.
 * Prioritizes standard AAC-LC (itag 140 @ 44.1kHz) or Opus (itag 251 @ 48kHz).
 * Specifically filters out ITAG 139 (HE-AAC v1 / SBR @ 22,050 Hz) which causes
 * browser media demuxers to calculate double (2x) duration and play trailing silence.
 */
export function selectOptimalAudioFormat(formats: any[]): any | null {
  const audioFormats = formats?.filter((f: any) => f.hasAudio && !f.hasVideo && f.url) || [];
  if (audioFormats.length === 0) return null;

  // 1. Prefer standard AAC-LC 128-130 kbps (ITAG 140) @ 44.1 kHz - universal browser native support
  const itag140 = audioFormats.find((f: any) => f.itag === 140);
  if (itag140) return itag140;

  // 2. Prefer high-quality Opus (ITAG 251) @ 48 kHz
  const itag251 = audioFormats.find((f: any) => f.itag === 251);
  if (itag251) return itag251;

  // 3. Filter out low-sample-rate HE-AAC formats with SBR timescale issues (itag 139 / mp4a.40.5 / <=24000Hz)
  const safeFormats = audioFormats.filter((f: any) => {
    const isHeAac =
      f.itag === 139 ||
      (typeof f.mimeType === "string" && f.mimeType.includes("mp4a.40.5")) ||
      (f.audioSampleRate && Number(f.audioSampleRate) <= 24000);
    return !isHeAac;
  });

  const pool = safeFormats.length > 0 ? safeFormats : audioFormats;
  return [...pool].sort((a: any, b: any) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0] || null;
}

/**
 * Resolves a track to its direct playable audio stream URL.
 * First tries YouTube direct audio with a strict safety timeout,
 * then seamlessly falls back to high-fidelity 30s public preview streams (iTunes/embed).
 * Caches the URL for fast repeated seek/playback requests.
 */
export async function getDirectAudioStreamUrl(
  trackName: string,
  artist?: string | null,
  directVideoId?: string | null,
): Promise<string | null> {
  const cacheKey = `${artist || ""}:${trackName}:${directVideoId || ""}`.toLowerCase();
  const cached = audioUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  // 1. Try YouTube stream extraction with a 3.5s timeout guard
  const videoId = directVideoId || (await resolveYouTubeVideoId(trackName, artist));
  if (videoId) {
    try {
      logger.info(`[AudioStream] Attempting direct audio stream for videoId: ${videoId}`);
      const infoPromise = ytdl.getInfo(videoId);
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("ytdl timeout after 3500ms")), 3500),
      );

      const info = (await Promise.race([infoPromise, timeoutPromise])) as any;
      const bestFormat = selectOptimalAudioFormat(info?.formats || []);

      if (bestFormat?.url) {
        logger.info(
          `[AudioStream] Selected format itag ${bestFormat.itag} (${bestFormat.mimeType || "audio"}, ${bestFormat.audioBitrate || "unknown"}kbps, ${bestFormat.audioSampleRate || "unknown"}Hz)`
        );
        audioUrlCache.set(cacheKey, {
          url: bestFormat.url,
          expiresAt: Date.now() + 3 * 3600 * 1000,
        });
        return bestFormat.url;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[AudioStream] YouTube stream extraction skipped/failed (${msg}), falling back to preview stream`);
    }
  }

  // 2. Seamless fallback: Public audio preview stream (iTunes / Apple Music 30s m4a stream)
  try {
    logger.info(`[AudioStream] Resolving public preview audio for "${trackName}" by "${artist || "Unknown"}"`);
    const previewUrl = await resolveTrackPreview("", trackName, artist);
    if (previewUrl) {
      audioUrlCache.set(cacheKey, {
        url: previewUrl,
        expiresAt: Date.now() + 24 * 3600 * 1000,
      });
      return previewUrl;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[AudioStream] Public preview fallback failed: ${msg}`);
  }

  logger.warn(`[AudioStream] No audio stream found for "${trackName}" by "${artist || "Unknown"}"`);
  return null;
}
