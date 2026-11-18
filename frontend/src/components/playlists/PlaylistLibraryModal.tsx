import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Play,
  Trash2,
  ListMusic,
  Music,
  ArrowLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { Track, Playlist } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useAudioPlayer } from '../../context/AudioPlayerContext';

interface PlaylistLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export function PlaylistLibraryModal({
  isOpen,
  onClose,
  onToast,
}: PlaylistLibraryModalProps) {
  const { user, isGuest, signInWithGoogle } = useAuth();
  const { playTrack } = useAudioPlayer();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    if (!user || isGuest) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setPlaylists(data || []);
    } catch (err) {
      console.error('[Echora Playlists] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, isGuest]);

  const fetchPlaylistTracks = useCallback(async (playlistId: string) => {
    setTracksLoading(true);
    try {
      const { data, error } = await supabase
        .from('playlist_tracks')
        .select('*, tracks(*)')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true });

      if (error) throw error;

      if (data) {
        const formatted: Track[] = [];
        for (const item of data) {
          const t = (item as any).tracks;
          if (t && t.id && t.name) {
            formatted.push({
              id: t.id,
              name: t.name,
              artists: t.artists || [],
              album: t.album || '',
              albumArtUrl: t.album_art_url || null,
              previewUrl: t.preview_url || null,
              durationMs: t.duration_ms || null,
              spotifyUrl: t.spotify_url || '',
              catalogSource: t.catalog_source || 'spotify',
              releaseYear: t.release_year || null,
            });
          }
        }

        setPlaylistTracks(formatted);
      }
    } catch (err) {
      console.error('[Echora Playlists] Fetch tracks error:', err);
    } finally {
      setTracksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSelectedPlaylist(null);
      setPlaylistTracks([]);
      void fetchPlaylists();
    }
  }, [isOpen, fetchPlaylists]);

  const handleOpenPlaylist = (pl: Playlist) => {
    setSelectedPlaylist(pl);
    void fetchPlaylistTracks(pl.id);
  };

  const handleDeletePlaylist = async (playlistId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this playlist?')) return;
    setIsDeleting(playlistId);

    try {
      const { error } = await supabase
        .from('playlists')
        .delete()
        .eq('id', playlistId);

      if (error) throw error;

      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(null);
        setPlaylistTracks([]);
      }
      onToast?.('Playlist deleted.', 'info');
    } catch (err: any) {
      onToast?.(err?.message || 'Failed to delete playlist.', 'error');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleRemoveTrack = async (trackId: string) => {
    if (!selectedPlaylist) return;

    try {
      const { error } = await supabase
        .from('playlist_tracks')
        .delete()
        .eq('playlist_id', selectedPlaylist.id)
        .eq('track_id', trackId);

      if (error) throw error;

      const removed = playlistTracks.find((t) => t.id === trackId);
      setPlaylistTracks((prev) => prev.filter((t) => t.id !== trackId));

      // Telemetry: -2.0 on playlist remove
      if (removed && removed.artists && removed.artists[0]) {
        try {
          await supabase.rpc('record_taste_interaction', {
            p_artist: removed.artists[0],
            p_delta: -2.0,
            p_genre: null,
          });
        } catch (rpcErr) {
          console.warn('[Taste Telemetry] Error recording playlist remove penalty:', rpcErr);
        }
      }

      onToast?.('Removed track from playlist.', 'info');
    } catch (err: any) {
      onToast?.(err?.message || 'Failed to remove track.', 'error');
    }
  };

  const handlePlayAll = () => {
    if (playlistTracks.length === 0) return;
    void playTrack(playlistTracks[0], playlistTracks);
    onToast?.(`Playing ${selectedPlaylist?.name}`, 'success');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl bg-ink-light border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-text"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {selectedPlaylist ? (
                <button
                  type="button"
                  onClick={() => setSelectedPlaylist(null)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-text-dim hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              ) : (
                <div className="w-10 h-10 rounded-2xl bg-cyan/15 border border-cyan/30 flex items-center justify-center text-cyan">
                  <ListMusic className="w-5 h-5" />
                </div>
              )}

              <div>
                <h2 className="text-lg font-bold text-text">
                  {selectedPlaylist ? selectedPlaylist.name : 'Your Playlists'}
                </h2>
                <p className="text-xs text-text-dim">
                  {selectedPlaylist
                    ? `${playlistTracks.length} tracks • ${selectedPlaylist.description || 'Custom playlist'}`
                    : `${playlists.length} playlists saved in your library`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {selectedPlaylist && playlistTracks.length > 0 && (
                <button
                  type="button"
                  onClick={handlePlayAll}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan text-ink font-semibold text-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-md shadow-cyan/20"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Play All
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 rounded-full text-text-dim hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {isGuest || !user ? (
              <div className="text-center py-12">
                <ListMusic className="w-12 h-12 mx-auto text-cyan/40 mb-3" />
                <h3 className="text-base font-semibold mb-2">Sign in to see your playlists</h3>
                <p className="text-sm text-text-dim max-w-sm mx-auto mb-6">
                  Sign in with your Google account to create playlists, save songs, and build your personalized musical taste profile.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void signInWithGoogle();
                    onClose();
                  }}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-cyan text-ink font-semibold text-sm hover:brightness-110 transition-all cursor-pointer shadow-lg shadow-cyan/20"
                >
                  <Sparkles className="w-4 h-4" /> Sign In with Google
                </button>
              </div>
            ) : selectedPlaylist ? (
              /* Playlist Track View */
              tracksLoading ? (
                <div className="flex items-center justify-center py-16 text-cyan">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : playlistTracks.length === 0 ? (
                <div className="text-center py-16 text-text-dim text-sm">
                  This playlist is empty. Click the <span className="text-cyan font-bold">+</span> button on any song card to add tracks!
                </div>
              ) : (
                <div className="space-y-2">
                  {playlistTracks.map((track, idx) => (
                    <div
                      key={track.id}
                      className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono text-text-faint w-5 text-right">
                          {idx + 1}
                        </span>
                        {track.albumArtUrl ? (
                          <img
                            src={track.albumArtUrl}
                            alt=""
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                            <Music className="w-4 h-4 text-text-faint" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text truncate">{track.name}</p>
                          <p className="text-xs text-text-dim truncate">
                            {track.artists.join(', ')} • {track.album}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void playTrack(track, playlistTracks)}
                          className="p-2 rounded-full hover:bg-cyan/20 text-cyan transition-colors cursor-pointer"
                          aria-label={`Play ${track.name}`}
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveTrack(track.id)}
                          className="p-2 rounded-full hover:bg-rose-500/20 text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          aria-label="Remove from playlist"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* Playlists Grid View */
              loading ? (
                <div className="flex items-center justify-center py-16 text-cyan">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              ) : playlists.length === 0 ? (
                <div className="text-center py-16 text-text-dim text-sm">
                  You haven't created any playlists yet. Click the <span className="text-cyan font-bold">+</span> button on any song to create one!
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {playlists.map((pl) => (
                    <div
                      key={pl.id}
                      onClick={() => handleOpenPlaylist(pl)}
                      className="p-4 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-cyan/30 transition-all cursor-pointer group flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-9 h-9 rounded-xl bg-cyan/10 text-cyan flex items-center justify-center">
                            <ListMusic className="w-4 h-4" />
                          </div>
                          <button
                            type="button"
                            disabled={isDeleting === pl.id}
                            onClick={(e) => void handleDeletePlaylist(pl.id, e)}
                            className="p-1.5 rounded-full hover:bg-rose-500/20 text-text-faint hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            aria-label="Delete playlist"
                          >
                            {isDeleting === pl.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <h3 className="font-semibold text-sm text-text truncate group-hover:text-cyan transition-colors">
                          {pl.name}
                        </h3>
                        <p className="text-xs text-text-dim line-clamp-2 mt-1">
                          {pl.description || 'Custom playlist'}
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-text-faint flex items-center justify-between">
                        <span>Created {new Date(pl.created_at).toLocaleDateString()}</span>
                        <span className="text-cyan group-hover:translate-x-0.5 transition-transform">
                          Open →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
