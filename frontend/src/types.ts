export type Energy = 'low' | 'medium' | 'high';
export type Tempo = 'slow' | 'medium' | 'fast' | 'any';
export type VocalPreference = 'instrumental_preferred' | 'vocals_preferred' | 'any';
export type TimeContext = 'morning' | 'afternoon' | 'evening' | 'late_night' | 'any';
export type PriorityLevel = 'high' | 'medium_high' | 'medium' | 'low' | 'none';

export interface CategorizedPreference<T> {
  value: T;
  source: 'explicit' | 'inferred' | 'optional' | 'unspecified';
  priority: PriorityLevel;
}

export interface MusicIntent {
  mood: string;
  persona?: string | null;
  activity: string | null;
  energy: Energy;
  tempo: Tempo;
  genre: string[];
  vocals: VocalPreference;
  time_context: TimeContext;
  language?: string | null;
  era?: string | null;
  trackTitle?: string | null;
  artist?: string | null;
  negativeConstraints?: {
    excludedArtists?: string[];
    excludedGenres?: string[];
    negativeKeywords?: string[];
  };
  sonicProfile?: {
    instruments?: string[];
    production?: string | null;
    tempoDescription?: string | null;
    emotionalSubtext?: string | null;
    harmonicMode?: 'minor' | 'major' | 'modal_dissonant' | null;
    vocalStyle?: string | null;
    antiSonicAura?: {
      forbiddenInstruments?: string[];
      forbiddenVibes?: string[];
    };
  };
  multiQueries?: {
    moodQuery: string;
    genreQuery: string;
    contextQuery: string;
    masterQuery?: string;
  };
  breakdown?: {
    mood: CategorizedPreference<string | null>;
    activity: CategorizedPreference<string | null>;
    energy: CategorizedPreference<Energy | null>;
    tempo: CategorizedPreference<Tempo | null>;
    genre: CategorizedPreference<string[]>;
    vocals: CategorizedPreference<VocalPreference | null>;
    time_context: CategorizedPreference<TimeContext | null>;
  };
}

export interface Track {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArtUrl: string | null;
  durationMs: number | null;
  spotifyUrl: string;
  catalogSource?: 'spotify' | 'youtube_music';
  catalogUrl?: string;
  previewUrl: string | null;
  releaseYear?: number | null;
  matchReason?: string | null;
  matchScore?: number | null;
  aiRecommended?: boolean;
}

export interface SearchResponse {
  mode: 'live' | 'mock';
  intent: MusicIntent;
  queries: {
    primary: string;
    alternatives?: string[];
  };
  tracks: Track[];
  resultConfidence?: number | null;
  aiRecommendationsAdded?: number;
  notice?: string;
  hasMore?: boolean;
}

export interface StatusResponse {
  mode: 'live' | 'mock';
  interpretMode: 'live' | 'mock';
  gemini: {
    configured: boolean;
    valid: boolean | null;
  };
  openRouter?: {
    configured: boolean;
    valid: boolean | null;
  };
  aiProviders?: {
    priority: Array<'gemini' | 'openRouter'>;
    lastUsed: 'gemini' | 'openRouter' | null;
  };
  spotify: {
    configured: boolean;
    valid: boolean | null;
    authorized: boolean;
  };
  youtubeMusic?: { available: boolean };
  missing: string[];
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ToastInfo {
  id: string;
  type?: 'info' | 'success' | 'error';
  message: string;
}

export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  track_count?: number;
}

export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: string;
  track?: Track;
}

export interface UserPreferencesRecord {
  user_id: string;
  discovery_mode: 'FAMILIAR' | 'BALANCED' | 'EXPLORE';
  favorite_artists: string[];
  favorite_genres: string[];
  disliked_artists: string[];
  disliked_genres: string[];
  preferred_language: string | null;
  allow_instrumental: boolean;
  updated_at: string;
}

export interface UserTasteProfileRecord {
  user_id: string;
  artist_affinities: Record<string, { weight: number; last_interacted_at: string }>;
  genre_affinities: Record<string, { weight: number; last_interacted_at: string }>;
  acoustic_tendencies: {
    preferred_energy?: string;
    preferred_tempo_range?: [number, number];
    vocals_bias?: string;
  };
  total_saved_tracks: number;
  updated_at: string;
}

