package com.mortisclub.kvinta;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

import android.app.Service;

public class PlaybackService extends Service {

    private static final String CHANNEL = "kvinta.playback";
    private static final int ID = 1;

    private static MediaSessionCompat session;
    private static String title = "";
    private static String artist = "";
    private static Bitmap artwork;
    private static boolean playing;

    static void update(Context ctx, MediaSessionCompat s, @Nullable String t, @Nullable String a,
                       @Nullable Bitmap art, boolean isPlaying) {
        if (s == null) return;
        session = s;
        if (t != null) title = t;
        if (a != null) artist = a;
        artwork = art;
        playing = isPlaying;
        launch(ctx, new Intent(ctx, PlaybackService.class));
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, PlaybackService.class));
    }

    private static void launch(Context ctx, Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(session, intent);
        Notification n = build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, ID, n,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, n);
        }
        if (!playing) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
        }
        return START_NOT_STICKY;
    }

    private Notification build() {
        createChannel();

        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_kvinta)
                .setContentTitle(title)
                .setContentText(artist)
                .setLargeIcon(artwork)
                .setContentIntent(open)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setShowWhen(false)
                .addAction(action(android.R.drawable.ic_media_previous, "Назад",
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
                .addAction(playing
                        ? action(android.R.drawable.ic_media_pause, "Пауза", PlaybackStateCompat.ACTION_PLAY_PAUSE)
                        : action(android.R.drawable.ic_media_play, "Играть", PlaybackStateCompat.ACTION_PLAY_PAUSE))
                .addAction(action(android.R.drawable.ic_media_next, "Вперёд",
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
                .setStyle(new MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

        return b.build();
    }

    private NotificationCompat.Action action(int icon, String label, long playbackAction) {
        return new NotificationCompat.Action(icon, label,
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, playbackAction));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Воспроизведение",
                NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
