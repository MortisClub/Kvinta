package com.mortisclub.kvinta;

import android.app.Dialog;
import android.graphics.Bitmap;
import android.net.Uri;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VkAuth")
public class VkAuth extends Plugin {

    private static final String AUTH_URL =
            "https://oauth.vk.com/authorize?client_id=2685278&scope=audio,offline"
                    + "&redirect_uri=https://oauth.vk.com/blank.html&display=mobile"
                    + "&response_type=token&revoke=1&v=5.131";

    private Dialog dialog;
    private boolean answered;

    @PluginMethod
    public void login(PluginCall call) {
        answered = false;
        getActivity().runOnUiThread(() -> {
            clearSession();

            WebView web = new WebView(getActivity());
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setUserAgentString("Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");

            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    handleUrl(call, url);
                }
            });

            dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
            dialog.setContentView(web, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            dialog.setOnCancelListener(d -> finish(call, null, null, "отменено"));
            dialog.show();

            web.loadUrl(AUTH_URL);
        });
    }

    private void handleUrl(PluginCall call, String url) {
        if (url == null || !url.startsWith("https://oauth.vk.com/blank.html")) return;
        String fragment = Uri.parse(url).getFragment();
        if (fragment == null) return;

        Uri parsed = Uri.parse("kvinta://vk?" + fragment);
        String token = parsed.getQueryParameter("access_token");
        if (token != null) {
            finish(call, token, parsed.getQueryParameter("user_id"), null);
        } else {
            String error = parsed.getQueryParameter("error_description");
            finish(call, null, null, error != null ? error : "вход не удался");
        }
    }

    private void finish(PluginCall call, String token, String userId, String error) {
        if (answered) return;
        answered = true;
        clearSession();
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        dialog = null;

        if (error != null) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("error", error);
            call.resolve(res);
            return;
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("token", token);
        res.put("userId", userId);
        call.resolve(res);
    }

    private void clearSession() {
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(null);
        cookies.flush();
        WebStorage.getInstance().deleteAllData();
    }
}
