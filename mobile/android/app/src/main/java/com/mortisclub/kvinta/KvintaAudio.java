package com.mortisclub.kvinta;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.media.AudioAttributesCompat;
import androidx.media.AudioFocusRequestCompat;
import androidx.media.AudioManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.net.URL;

@CapacitorPlugin(name = "KvintaAudio")
public class KvintaAudio extends Plugin {

    private AudioManager audioManager;
    private AudioFocusRequestCompat focusRequest;
    private MediaSessionCompat session;
    private BroadcastReceiver noisyReceiver;
    private boolean playing = false;
    private long duration = 0;
    private String artworkUrl = "";
    private Bitmap artwork = null;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (session == null) {
                session = new MediaSessionCompat(getContext(), "Kvinta");
                session.setCallback(new MediaSessionCompat.Callback() {
                    @Override
                    public void onPlay() { emit("play", 0); }

                    @Override
                    public void onPause() { emit("pause", 0); }

                    @Override
                    public void onSkipToNext() { emit("next", 0); }

                    @Override
                    public void onSkipToPrevious() { emit("previous", 0); }

                    @Override
                    public void onStop() { emit("stop", 0); }

                    @Override
                    public void onSeekTo(long pos) { emit("seek", pos); }
                });
                session.setActive(true);
            }
            registerNoisyReceiver();
            requestFocus();
            call.resolve();
        });
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        final String title = call.getString("title", "");
        final String artist = call.getString("artist", "");
        final String album = call.getString("album", "");
        final String art = call.getString("artwork", "");
        duration = call.getLong("duration", 0L) * 1000L;

        if (!art.equals(artworkUrl)) {
            artworkUrl = art;
            artwork = null;
            new Thread(() -> {
                Bitmap bmp = loadArtwork(art);
                getActivity().runOnUiThread(() -> {
                    artwork = bmp;
                    applyMetadata(title, artist, album);
                    PlaybackService.update(getContext(), session, title, artist, artwork, playing);
                });
            }).start();
        }

        getActivity().runOnUiThread(() -> {
            applyMetadata(title, artist, album);
            PlaybackService.update(getContext(), session, title, artist, artwork, playing);
            call.resolve();
        });
    }

    @PluginMethod
    public void setState(PluginCall call) {
        playing = call.getBoolean("playing", false);
        final long position = call.getLong("position", 0L) * 1000L;
        getActivity().runOnUiThread(() -> {
            if (session != null) {
                session.setPlaybackState(new PlaybackStateCompat.Builder()
                        .setActions(PlaybackStateCompat.ACTION_PLAY
                                | PlaybackStateCompat.ACTION_PAUSE
                                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                                | PlaybackStateCompat.ACTION_SEEK_TO
                                | PlaybackStateCompat.ACTION_STOP)
                        .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                                position, 1.0f)
                        .build());
            }
            if (playing) requestFocus();
            PlaybackService.update(getContext(), session, null, null, artwork, playing);
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            abandonFocus();
            unregisterNoisyReceiver();
            if (session != null) {
                session.setActive(false);
                session.release();
                session = null;
            }
            PlaybackService.stop(getContext());
            call.resolve();
        });
    }

    private void applyMetadata(String title, String artist, String album) {
        if (session == null) return;
        MediaMetadataCompat.Builder md = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        if (artwork != null) md.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
        session.setMetadata(md.build());
    }

    private Bitmap loadArtwork(String url) {
        if (url == null || url.isEmpty()) return null;
        try (InputStream in = new URL(url).openStream()) {
            return BitmapFactory.decodeStream(in);
        } catch (Exception e) {
            return null;
        }
    }

    private void emit(String action, long position) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("position", position / 1000.0);
        notifyListeners("transport", data);
    }

    private void registerNoisyReceiver() {
        if (noisyReceiver != null) return;
        noisyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                    emit("pause", 0);
                }
            }
        };
        getContext().registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    }

    private void unregisterNoisyReceiver() {
        if (noisyReceiver == null) return;
        try {
            getContext().unregisterReceiver(noisyReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        noisyReceiver = null;
    }

    private void requestFocus() {
        if (focusRequest != null) return;
        AudioAttributesCompat attrs = new AudioAttributesCompat.Builder()
                .setUsage(AudioAttributesCompat.USAGE_MEDIA)
                .setContentType(AudioAttributesCompat.CONTENT_TYPE_MUSIC)
                .build();
        focusRequest = new AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(change -> {
                    if (change == AudioManager.AUDIOFOCUS_LOSS
                            || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        emit("pause", 0);
                    } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                        emit("duck", 0);
                    } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                        emit("unduck", 0);
                    }
                })
                .build();
        AudioManagerCompat.requestAudioFocus(audioManager, focusRequest);
    }

    private void abandonFocus() {
        if (focusRequest == null) return;
        AudioManagerCompat.abandonAudioFocusRequest(audioManager, focusRequest);
        focusRequest = null;
    }

    @Override
    protected void handleOnDestroy() {
        unregisterNoisyReceiver();
        abandonFocus();
        if (session != null) {
            session.release();
            session = null;
        }
        PlaybackService.stop(getContext());
    }
}
