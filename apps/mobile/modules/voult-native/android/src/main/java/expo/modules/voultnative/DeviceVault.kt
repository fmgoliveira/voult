package expo.modules.voultnative

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small private files (the autofill index, a login waiting to be saved) encrypted with a
 * hardware-backed Keystore key that needs no user authentication, so the autofill service and the
 * credential provider can read them while the app is not running.
 */
object DeviceVault {
  private const val ALIAS = "voult.autofill.files"
  private const val PROVIDER = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  const val INDEX = "autofill.index"
  const val PENDING_SAVE = "pending-save"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance(PROVIDER).apply { load(null) }
    (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val spec = KeyGenParameterSpec.Builder(
      ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build()
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
      .apply { init(spec) }
      .generateKey()
  }

  private fun file(ctx: Context, name: String) = File(ctx.filesDir, "voult-$name.bin")

  @Synchronized
  fun write(ctx: Context, name: String, text: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
    val out = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    val target = file(ctx, name)
    val tmp = File(target.path + ".tmp")
    tmp.writeBytes(out)
    if (!tmp.renameTo(target)) {
      target.delete()
      tmp.renameTo(target)
    }
  }

  @Synchronized
  fun read(ctx: Context, name: String): String? {
    val f = file(ctx, name)
    if (!f.exists()) return null
    return try {
      val bytes = f.readBytes()
      val cipher = Cipher.getInstance(TRANSFORMATION).apply {
        init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      }
      String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  @Synchronized
  fun delete(ctx: Context, name: String) {
    file(ctx, name).delete()
  }

  /** The login queued by a save request, if it is under an hour old. Consumed once. */
  fun takePendingSave(ctx: Context): String? {
    val raw = read(ctx, PENDING_SAVE) ?: return null
    delete(ctx, PENDING_SAVE)
    val at = try {
      org.json.JSONObject(raw).optLong("at")
    } catch (_: Exception) {
      0L
    }
    return if (System.currentTimeMillis() - at <= 60 * 60 * 1000L) raw else null
  }
}
