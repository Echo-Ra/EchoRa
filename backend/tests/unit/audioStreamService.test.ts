import { describe, it, expect } from "vitest";
import { selectOptimalAudioFormat } from "../../src/services/music/audioStreamService.js";

describe("audioStreamService.selectOptimalAudioFormat", () => {
  it("returns null for empty formats array", () => {
    expect(selectOptimalAudioFormat([])).toBeNull();
  });

  it("prioritizes standard AAC-LC (itag 140) over low-bitrate HE-AAC (itag 139)", () => {
    const formats = [
      {
        itag: 139,
        mimeType: 'audio/mp4; codecs="mp4a.40.5"',
        audioBitrate: 49,
        audioSampleRate: "22050",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag139",
      },
      {
        itag: 140,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        audioBitrate: 130,
        audioSampleRate: "44100",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag140",
      },
      {
        itag: 251,
        mimeType: 'audio/webm; codecs="opus"',
        audioBitrate: 134,
        audioSampleRate: "48000",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag251",
      },
    ];

    const selected = selectOptimalAudioFormat(formats);
    expect(selected).not.toBeNull();
    expect(selected.itag).toBe(140);
    expect(selected.url).toBe("https://example.com/itag140");
  });

  it("prioritizes Opus itag 251 when itag 140 is absent", () => {
    const formats = [
      {
        itag: 139,
        mimeType: 'audio/mp4; codecs="mp4a.40.5"',
        audioBitrate: 49,
        audioSampleRate: "22050",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag139",
      },
      {
        itag: 251,
        mimeType: 'audio/webm; codecs="opus"',
        audioBitrate: 134,
        audioSampleRate: "48000",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag251",
      },
    ];

    const selected = selectOptimalAudioFormat(formats);
    expect(selected).not.toBeNull();
    expect(selected.itag).toBe(251);
  });

  it("filters out HE-AAC SBR formats (sampleRate <= 24000) when higher quality audio exists", () => {
    const formats = [
      {
        itag: 139,
        mimeType: 'audio/mp4; codecs="mp4a.40.5"',
        audioBitrate: 49,
        audioSampleRate: "22050",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag139",
      },
      {
        itag: 250,
        mimeType: 'audio/webm; codecs="opus"',
        audioBitrate: 68,
        audioSampleRate: "48000",
        hasAudio: true,
        hasVideo: false,
        url: "https://example.com/itag250",
      },
    ];

    const selected = selectOptimalAudioFormat(formats);
    expect(selected).not.toBeNull();
    expect(selected.itag).toBe(250);
  });

  it("ignores video formats without audio or formats without a URL", () => {
    const formats = [
      {
        itag: 137,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        hasAudio: false,
        hasVideo: true,
        url: "https://example.com/video-only",
      },
      {
        itag: 140,
        hasAudio: true,
        hasVideo: false,
        url: "", // empty url
      },
    ];

    expect(selectOptimalAudioFormat(formats)).toBeNull();
  });
});
