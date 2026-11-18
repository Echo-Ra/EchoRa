import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Check, FolderPlus, Loader2, Music, Sparkles } from 'lucide-react';
import type { Track, Playlist } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface AddToPlaylistModalProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
  onToast?: (message: string, type?: 'success' | 'info' | 'error') => void;
}

export function AddToPlaylistModal({
  track,
  isOpen,
  onClose,
  onToast,
}: AddToPlaylistModalProps) {
  const { user, isGuest, signInWithGoogle } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingToId, setAddingToId] = useState<string | null>(null);
  const [addedPlaylistIds, setAddedPlaylistIds] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    if (!user || isGuest) return;
    setLoading(true);
    try {
      const { data: userPlaylists, error: pError } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (pError) throw pError;
      setPlaylists(userPlaylists || []);

      if (track && userPlaylists && userPlaylists.length > 0) {
        const playlistIds = userPlaylists.map((p) => p.id);
        const { data: containedTracks } = await supabase
          .from('playlist_tracks')
          .select('playlist_id')
          .eq('track_id', track.id)
          .in('playlist_id', playlistIds);

        if (containedTracks) {
          setAddedPlaylistIds(new Set(containedTracks.map((pt) => pt.playlist_id)));
        }
      }
    } catch (err) {
      console.error('[Echora Playlists] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, isGuest, track]);

  useEffect(() => {
    if (isOpen) {
      void fetchPlaylists();
      setShowCreateForm(false);
      setNewPlaylistName('');
    }
  }, [isOpen, fetchPlaylists]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddToPlaylist = async (playlist: Playlist) => {
    if (!track || !user) return;
    setAddingToId(playlist.id);

    try {
      // 1. Atomic upsert to master catalog (public.tracks) with ignoreDuplicates
      await supabase.from('tracks').upsert(
        {
          id: track.id,
          name: track.name,
          artists: track.artists,
          album: track.album || null,
          album_art_url: track.albumArtUrl || null,
          preview_url: track.previewUrl || null,
          duration_ms: track.durationMs || 0,
          spotify_url: track.spotifyUrl || null,
          catalog_source: track.catalogSource || 'spotify',
          release_year: track.releaseYear || null,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

      // 2. Count existing tracks to assign next position
      const { count } = await supabase
        .from('playlist_tracks')
        .select('*', { count: 'exact', head: true })
        .eq('playlist_id', playlist.id);

      const nextPos = (count || 0) + 1;

      // 3. Insert into public.playlist_tracks
      const { error: ptError } = await supabase.from('playlist_tracks').upsert(
        {
          playlist_id: playlist.id,
          track_id: track.id,
          position: nextPos,
        },
        { onConflict: 'playlist_id,track_id', ignoreDuplicates: true },
      );

      if (ptError) throw ptError;

      // 4. Update playlist updated_at
      await supabase
        .from('playlists')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', playlist.id);

      // 5. Database-as-Brain Telemetry: Reward artist (+3.0)
      if (track.artists && track.artists[0]) {
        try {
          const { error: rpcError } = await supabase.rpc('record_taste_interaction', {
            p_artist: track.artists[0],
            p_delta: 3.0,
            p_genre: null,
          });
          if (rpcError) {
            console.warn('[Taste Telemetry] RPC error recording taste interaction:', rpcError);
          }
        } catch (rpcErr) {
          console.warn('[Taste Telemetry] Error recording interaction:', rpcErr);
        }
      }

      setAddedPlaylistIds((prev) => new Set([...prev, playlist.id]));
      onToast?.(`Added "${track.name}" to ${playlist.name}`, 'success');
    } catch (err: any) {
      console.error('[Echora Playlists] Add track error:', err);
      onToast?.(err?.message || 'Could not add track to playlist.', 'error');
    } finally {
      setAddingToId(null);
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name || !user) return;

    setIsCreating(true);
    try {
      const { data: newPl, error: createError } = await supabase
        .from('playlists')
        .insert({
          user_id: user.id,
          name,
          description: 'Custom playlist created on EchoRa',
        })
        .select()
        .single();

      if (createError) throw createError;

      if (newPl) {
        setPlaylists((prev) => [newPl, ...prev]);
        setShowCreateForm(false);
        setNewPlaylistName('');
        // Automatically add current track to the newly created playlist
        await handleAddToPlaylist(newPl);
      }
    } catch (err: any) {
      console.error('[Echora Playlists] Create error:', err);
      onToast?.(err?.message || 'Failed to create playlist.', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen || !track) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-md bg-ink-light border border-white/10 rounded-2xl shadow-2xl p-6 text-text overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan/15 border border-cyan/30 flex items-center justify-center text-cyan">
                <Music className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-text">Add to Playlist</h3>
                <p className="text-xs text-text-dim truncate max-w-[260px]">
                  {track.name} • {track.artists.join(', ')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 rounded-full text-text-dim hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="py-4">
            {isGuest || !user ? (
              <div className="text-center py-6">
                <p className="text-sm text-text-dim mb-4">
                  Sign in with Google to create and save custom playlists to your library.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void signInWithGoogle();
                    onClose();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan text-ink font-semibold text-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-lg shadow-cyan/20"
                >
                  <Sparkles className="w-4 h-4" />
                  Sign In with Google
                </button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-8 text-cyan">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Playlist list */}
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {playlists.length === 0 ? (
                    <div className="text-center py-6 text-text-dim text-sm">
                      You don't have any playlists yet. Create your first one below!
                    </div>
                  ) : (
                    playlists.map((pl) => {
                      const isAdded = addedPlaylistIds.has(pl.id);
                      const isAdding = addingToId === pl.id;

                      return (
                        <button
                          key={pl.id}
                          type="button"
                          disabled={isAdded || isAdding}
                          onClick={() => void handleAddToPlaylist(pl)}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                            isAdded
                              ? 'bg-cyan/10 border-cyan/40 text-cyan cursor-default'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/5 hover:border-cyan/30 text-text cursor-pointer'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <p className="text-sm font-medium truncate">{pl.name}</p>
                            <p className="text-xs text-text-faint">
                              {pl.description || 'Custom playlist'}
                            </p>
                          </div>
                          <div className="shrink-0">
                            {isAdding ? (
                              <Loader2 className="w-4 h-4 animate-spin text-cyan" />
                            ) : isAdded ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan">
                                <Check className="w-4 h-4" /> Added
                              </span>
                            ) : (
                              <Plus className="w-4 h-4 text-text-dim hover:text-white" />
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Create Playlist Section */}
                <div className="pt-2 border-t border-white/10">
                  {showCreateForm ? (
                    <form onSubmit={(e) => void handleCreatePlaylist(e)} className="flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        placeholder="Playlist name..."
                        value={newPlaylistName}
                        onChange={(e) => setNewPlaylistName(e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-white/15 focus:border-cyan rounded-xl px-3 py-2 text-sm text-text placeholder-text-faint outline-none transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={!newPlaylistName.trim() || isCreating}
                        className="px-4 py-2 bg-cyan text-ink font-semibold text-xs rounded-xl hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        className="p-2 text-text-dim hover:text-white transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-dashed border-white/20 hover:border-cyan/50 text-sm font-medium text-text-dim hover:text-cyan hover:bg-cyan/5 transition-all cursor-pointer"
                    >
                      <FolderPlus className="w-4 h-4" />
                      New Playlist
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
