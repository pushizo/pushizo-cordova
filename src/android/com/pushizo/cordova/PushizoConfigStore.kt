package com.pushizo.cordova

import android.content.Context
import com.pushizo.sdk.Pushizo

/**
 * JS `initialize` ayarlarını saklar. Süreç bildirim tıklaması veya FCM servisi ile yeniden başladığında
 * SDK, WebView yüklenmeden önce bu ayarlarla başlatılır (soğuk başlatma tıklaması ve `received` kaybolmaz).
 * Yalnızca uygulama kimliği ve herkese açık ayarlar tutulur; gizli bilgi yoktur.
 */
internal object PushizoConfigStore {
    private const val PREFS = "pushizo_cordova"

    data class Config(val appId: String, val apiUrl: String, val requiresPrivacyConsent: Boolean, val logLevel: String) {
        fun toOptions() = Pushizo.Options(
            apiUrl = apiUrl,
            requiresPrivacyConsent = requiresPrivacyConsent,
            logLevel = PushizoBridgeCore.logLevel(logLevel),
        )
    }

    fun save(context: Context, config: Config) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("app_id", config.appId)
            .putString("api_url", config.apiUrl)
            .putBoolean("requires_privacy_consent", config.requiresPrivacyConsent)
            .putString("log_level", config.logLevel)
            .apply()
    }

    fun load(context: Context): Config? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val appId = prefs.getString("app_id", null)?.takeIf { it.isNotBlank() } ?: return null
        return Config(
            appId = appId,
            apiUrl = prefs.getString("api_url", null) ?: Pushizo.Options().apiUrl,
            requiresPrivacyConsent = prefs.getBoolean("requires_privacy_consent", false),
            logLevel = prefs.getString("log_level", null) ?: "warn",
        )
    }
}
