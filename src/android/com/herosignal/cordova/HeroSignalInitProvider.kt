package com.herosignal.cordova

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.herosignal.sdk.HeroSignal
import com.herosignal.sdk.HsLog

/**
 * Süreç başında (Application.onCreate'ten sonra, ilk Activity/servis çalışmadan önce) kayıtlı ayarlarla SDK'yı
 * başlatır. İlk kurulumda kayıt olmadığından hiçbir şey yapmaz; başlatma JS `initialize` ile olur.
 * Firebase ve androidx.startup sağlayıcılarının tamamlanması için başlatma ana iş parçacığına ertelenir.
 */
class HeroSignalInitProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val ctx = context?.applicationContext ?: return false
        Handler(Looper.getMainLooper()).post {
            if (HeroSignal.isInitialized) return@post
            val config = HeroSignalConfigStore.load(ctx) ?: return@post
            runCatching { HeroSignal.initialize(ctx, config.appId, config.toOptions()) }
                .onFailure { HsLog.w("kayıtlı ayarlarla başlatılamadı", it) }
        }
        return true
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
