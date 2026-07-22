package com.mortisclub.kvinta;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KvintaAudio.class);
        registerPlugin(ApkInstaller.class);
        registerPlugin(VkAuth.class);
        super.onCreate(savedInstanceState);
    }
}
