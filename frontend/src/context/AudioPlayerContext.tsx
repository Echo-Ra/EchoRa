import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { Track } from '../types';
import { supabase } from '../lib/supabase';

const LAST_PLAYING_TRACK_KEY = 'echora:last-playing-track';

interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  queue: Track[];
  queueIndex: number;
  playTrack: (track: Track, newQueue?: Track[], options?: { loopAtEnd?: boolean }) => Promise<void>;
  togglePlayPause: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  playNext: () => void;
  playPrevious: () => void;
  appendQueue: (newTracks: Track[]) => void;
  closePlayer: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Live refs to guarantee immediate access in event listeners without stale closures
  const queueRef = useRef<Track[]>([]);
  const currentTrackRef = useRef<Track | null>(null);
  const loopAtEndRef = useRef<boolean>(true);
  const hasLoggedListenRef = useRef<boolean>(false);
  const hasLoggedCompleteRef = useRef<boolean>(false);
  const artistListenTimesRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  // Initialize native HTML5 Audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 0.85;
    audioRef.current = audio;

    const onEnded = () => {
      // Full completion reward (+0.5) if song played to completion naturally
      if (hasLoggedListenRef.current && !hasLoggedCompleteRef.current) {
        hasLoggedCompleteRef.current = true;
        const current = currentTrackRef.current;
        if (current && current.artists && current.artists[0]) {
          const logComplete = async () => {
            try {
              const { error: rpcErr } = await supabase.rpc('record_taste_interaction', {
                p_artist: current.artists[0],
                p_delta: 0.5,
                p_genre: null,
              });
              if (rpcErr) console.warn('[Taste Telemetry] Full completion RPC error:', rpcErr);
            } catch (err) {
              console.warn('[Taste Telemetry] Full completion error:', err);
            }
          };
          void logComplete();
        }
      }
      handleAutoNext();
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);

      const track = currentTrackRef.current;
      const expectedSec = track?.durationMs ? track.durationMs / 1000 : 0;

      // Guard: If audio stream exceeds known track length and playback reaches end of actual song, advance cleanly
      if (expectedSec > 30 && audio.duration > expectedSec + 20 && audio.currentTime >= expectedSec) {
        onEnded();
        return;
      }

      // 30s listen telemetry trigger for Database-as-Brain (with loop cooldown: max 2 rewards/artist/hour)
      if (audio.currentTime >= 30 && !hasLoggedListenRef.current) {
        hasLoggedListenRef.current = true;
        const current = currentTrackRef.current;
        if (current && current.artists && current.artists[0]) {
          const artistKey = current.artists[0].toLowerCase().trim();
          const now = Date.now();
          const oneHourAgo = now - 60 * 60 * 1000;
          const prevTimes = (artistListenTimesRef.current.get(artistKey) || []).filter((t) => t > oneHourAgo);

          if (prevTimes.length < 2) {
            artistListenTimesRef.current.set(artistKey, [...prevTimes, now]);
            const logListen = async () => {
              try {
                const { error: rpcErr } = await supabase.rpc('record_taste_interaction', {
                  p_artist: current.artists[0],
                  p_delta: 1.0,
                  p_genre: null,
                });
                if (rpcErr) console.warn('[Taste Telemetry] 30s listen RPC error:', rpcErr);
              } catch (err) {
                console.warn('[Taste Telemetry] 30s listen error:', err);
              }
            };
            void logListen();
          }
        }
      }
    };

    const onDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        const track = currentTrackRef.current;
        const expectedSec = track?.durationMs ? track.durationMs / 1000 : 0;
        // If stream duration is significantly inflated (e.g. >1.5x expected length from HE-AAC or video bloat),
        // clamp to expected duration so scrubber remains accurate to the actual song
        if (expectedSec > 30 && audio.duration > expectedSec * 1.5) {
          setDuration(expectedSec);
        } else {
          setDuration(audio.duration);
        }
      }
    };

    const onWaiting = () => {
      setIsBuffering(true);
    };

    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };

    const onPause = () => {
      setIsPlaying(false);
      setIsBuffering(false);
    };

    const onError = (e: Event) => {
      console.warn('[Echora Audio] Stream notice/recovering:', e);
      setIsBuffering(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
    };
  }, []);

  const playTrack = useCallback(
    async (track: Track, newQueue?: Track[], options?: { loopAtEnd?: boolean }) => {
      if (options?.loopAtEnd !== undefined) {
        loopAtEndRef.current = options.loopAtEnd;
      } else if (newQueue) {
        loopAtEndRef.current = true;
      }

      setCurrentTrack(track);
      currentTrackRef.current = track;
      hasLoggedListenRef.current = false;
      hasLoggedCompleteRef.current = false;
      try {
        sessionStorage.setItem(LAST_PLAYING_TRACK_KEY, JSON.stringify(track));
      } catch {
        // Playback should still work when browser storage is unavailable.
      }
      setIsBuffering(true);
      setCurrentTime(0);
      setDuration(track.durationMs ? track.durationMs / 1000 : 0);

      if (newQueue && newQueue.length > 0) {
        setQueue(newQueue);
        queueRef.current = newQueue;
      } else if (queueRef.current.length === 0) {
        setQueue([track]);
        queueRef.current = [track];
      }

      const audio = audioRef.current;
      if (!audio) return;

      try {
        const artist = track.artists?.join(' ') || '';
        const streamUrl = `/api/music/stream?track=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(artist)}`;

        audio.src = streamUrl;
        audio.load();
        await audio.play();
        setIsPlaying(true);
        setIsBuffering(false);

        // Update OS Media Session (Lock screen, Mac Control Center, AirPods)
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artists?.join(', ') || 'Unknown Artist',
            album: track.album || 'EchoRa Stream',
            artwork: track.albumArtUrl
              ? [{ src: track.albumArtUrl, sizes: '512x512', type: 'image/jpeg' }]
              : [],
          });
        }
      } catch (err: unknown) {
        console.warn('[Echora Audio] Autoplay deferred until user interaction:', err);
        setIsBuffering(false);
      }
    },
    [],
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.currentTime = seconds;
      setCurrentTime(seconds);
    } catch {
      // ignore
    }
  }, []);

  const setVolume = useCallback((newVol: number) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolumeState(clamped);
    setIsMuted(clamped === 0);
    const audio = audioRef.current;
    if (audio) {
      audio.volume = clamped;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMuted) {
      audio.muted = false;
      audio.volume = volume;
      setIsMuted(false);
    } else {
      audio.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const playNext = useCallback(() => {
    const activeQueue = queueRef.current;
    const activeTrack = currentTrackRef.current;
    const audio = audioRef.current;

    // Fast skip telemetry: deliberate skip between 2s and 10s (ignoring accidental <2s skips)
    if (audio && audio.currentTime >= 2.0 && audio.currentTime < 10 && !hasLoggedListenRef.current) {
      if (activeTrack && activeTrack.artists && activeTrack.artists[0]) {
        const logSkip = async () => {
          try {
            const { error: rpcErr } = await supabase.rpc('record_taste_interaction', {
              p_artist: activeTrack.artists[0],
              p_delta: -1.0,
              p_genre: null,
            });
            if (rpcErr) console.warn('[Taste Telemetry] Fast skip RPC error:', rpcErr);
          } catch (err) {
            console.warn('[Taste Telemetry] Fast skip error:', err);
          }
        };
        void logSkip();
      }
    }

    if (!activeTrack || activeQueue.length === 0) return;

    const currentIndex = activeQueue.findIndex((t) => t.id === activeTrack.id);
    if (currentIndex !== -1 && currentIndex + 1 < activeQueue.length) {
      void playTrack(activeQueue[currentIndex + 1]);
    } else if (loopAtEndRef.current && activeQueue.length > 0) {
      void playTrack(activeQueue[0]);
    } else {
      setIsPlaying(false);
      setIsBuffering(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  }, [playTrack]);

  const handleAutoNext = useCallback(() => {
    const activeQueue = queueRef.current;
    const activeTrack = currentTrackRef.current;
    if (!activeTrack || activeQueue.length === 0) return;

    const currentIndex = activeQueue.findIndex((t) => t.id === activeTrack.id);
    if (currentIndex !== -1 && currentIndex + 1 < activeQueue.length) {
      void playTrack(activeQueue[currentIndex + 1]);
    } else if (loopAtEndRef.current && activeQueue.length > 0) {
      void playTrack(activeQueue[0]);
    } else {
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, [playTrack]);

  const playPrevious = useCallback(() => {
    const activeQueue = queueRef.current;
    const activeTrack = currentTrackRef.current;
    const audio = audioRef.current;

    // If song is past 3 seconds, replay from beginning
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    if (!activeTrack || activeQueue.length === 0) return;

    const currentIndex = activeQueue.findIndex((t) => t.id === activeTrack.id);
    if (currentIndex > 0) {
      void playTrack(activeQueue[currentIndex - 1]);
    } else if (loopAtEndRef.current && activeQueue.length > 0) {
      void playTrack(activeQueue[activeQueue.length - 1]);
    }
  }, [playTrack]);

  const appendQueue = useCallback((newTracks: Track[]) => {
    if (!newTracks || newTracks.length === 0) return;
    setQueue((prev) => {
      const existingIds = new Set(prev.map((t) => t.id));
      const filtered = newTracks.filter((t) => !existingIds.has(t.id));
      const updated = [...prev, ...filtered];
      queueRef.current = updated;
      return updated;
    });
  }, []);

  const closePlayer = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setCurrentTrack(null);
    currentTrackRef.current = null;
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    setQueue([]);
    queueRef.current = [];
    try {
      sessionStorage.removeItem(LAST_PLAYING_TRACK_KEY);
    } catch {
      // Ignore unavailable browser storage.
    }
  }, []);

  const restoredTrackRef = useRef(false);
  useEffect(() => {
    if (restoredTrackRef.current) return;
    restoredTrackRef.current = true;
    try {
      const savedTrack = sessionStorage.getItem(LAST_PLAYING_TRACK_KEY);
      if (!savedTrack) return;
      const track = JSON.parse(savedTrack) as Track;
      if (!track || typeof track.id !== 'string' || typeof track.name !== 'string') {
        sessionStorage.removeItem(LAST_PLAYING_TRACK_KEY);
        return;
      }
      void playTrack(track, [track]);
    } catch {
      try {
        sessionStorage.removeItem(LAST_PLAYING_TRACK_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
    }
  }, [playTrack]);

  // Set up OS media controls
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    }
  }, [togglePlayPause, playPrevious, playNext]);

  const queueIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;

  return (
    <AudioPlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        isBuffering,
        currentTime,
        duration,
        volume,
        isMuted,
        queue,
        queueIndex,
        playTrack,
        togglePlayPause,
        seekTo,
        setVolume,
        toggleMute,
        playNext,
        playPrevious,
        appendQueue,
        closePlayer,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider');
  }
  return ctx;
}
