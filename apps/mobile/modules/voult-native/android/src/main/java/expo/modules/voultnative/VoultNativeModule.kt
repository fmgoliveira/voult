package expo.modules.voultnative

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native helpers for Voult: Argon2id, Android Keystore keys (optionally gated by biometrics),
 * FLAG_SECURE and a clipboard copy that is flagged sensitive.
 *
 * Binary values cross the JS boundary as unpadded URL-safe base64 (same encoding as @voult/core).
 */
class VoultNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  private val activity: Activity
    get() = appContext.currentActivity ?: throw Exceptions.MissingActivity()

  private val main = Handler(Looper.getMainLooper())
  private var clearRunnable: Runnable? = null

  private fun b64(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  private fun unb64(s: String): ByteArray =
    Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  override fun definition() = ModuleDefinition {
    Name("VoultNative")

    // ------------------------------------------------------------------ Argon2id

    AsyncFunction("argon2id") { password: String, saltB64: String, memoryKiB: Int, iterations: Int, parallelism: Int ->
      val result = Argon2Kt().hash(
        mode = Argon2Mode.ARGON2_ID,
        password = password.toByteArray(Charsets.UTF_8),
        salt = unb64(saltB64),
        tCostInIterations = iterations,
        mCostInKibibyte = memoryKiB,
        parallelism = parallelism,
        hashLengthInBytes = 32,
      )
      b64(result.rawHashAsByteArray())
    }

    // ------------------------------------------------------------------ screen capture

    /** Blocks screenshots, screen recording and the recents thumbnail while enabled. */
    AsyncFunction("setSecureScreen") { enabled: Boolean ->
      val act = activity
      act.runOnUiThread {
        if (enabled) act.window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        else act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }

    // ------------------------------------------------------------------ clipboard

    /**
     * Copies text flagged as sensitive (hidden from clipboard previews and keyboard suggestions on
     * Android 13+) and tries to clear it after [clearAfterMs]. Android 10+ only lets the focused
     * app touch the clipboard, so a clear while backgrounded may be refused; [clearClipboard] is
     * also called when the app returns to the foreground.
     */
    Function("copySensitive") { text: String, clearAfterMs: Long ->
      val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = ClipData.newPlainText("voult", text)
      clip.description.extras = PersistableBundle().apply {
        // ClipDescription.EXTRA_IS_SENSITIVE (API 33); the literal also works on older versions.
        putBoolean("android.content.extra.IS_SENSITIVE", true)
      }
      cm.setPrimaryClip(clip)
      clearRunnable?.let { main.removeCallbacks(it) }
      if (clearAfterMs > 0) {
        val r = Runnable { clearNow() }
        clearRunnable = r
        main.postDelayed(r, clearAfterMs)
      }
    }

    Function("clearClipboard") { clearNow() }

    // ------------------------------------------------------------------ biometrics

    Function("isBiometricAvailable") {
      BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS
    }

    // ------------------------------------------------------------------ Keystore

    Function("keystoreHas") { alias: String -> keyStore().containsAlias(alias) }

    Function("keystoreDelete") { alias: String ->
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
    }

    /**
     * Creates (replacing any existing) AES-256-GCM key. With [requireBiometric] every use needs a
     * fresh strong-biometric authentication and the key is destroyed if biometrics are re-enrolled.
     */
    Function("keystoreCreate") { alias: String, requireBiometric: Boolean ->
      val ks = keyStore()
      if (ks.containsAlias(alias)) ks.deleteEntry(alias)
      generateKey(alias, requireBiometric, strongBox = true)
    }

    AsyncFunction("keystoreEncrypt") { alias: String, plaintextB64: String, title: String, subtitle: String, promise: Promise ->
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(alias))
        runCipher(alias, cipher, unb64(plaintextB64), title, subtitle, promise) { out ->
          mapOf("ciphertext" to b64(out), "iv" to b64(cipher.iv))
        }
      } catch (e: KeyPermanentlyInvalidatedException) {
        promise.reject("ERR_KEY_INVALIDATED", "Biometrics changed; the key is no longer valid", e)
      } catch (e: Exception) {
        promise.reject("ERR_KEYSTORE", e.message ?: "keystore error", e)
      }
    }

    AsyncFunction("keystoreDecrypt") { alias: String, ciphertextB64: String, ivB64: String, title: String, subtitle: String, promise: Promise ->
      try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(alias), GCMParameterSpec(128, unb64(ivB64)))
        runCipher(alias, cipher, unb64(ciphertextB64), title, subtitle, promise) { out -> b64(out) }
      } catch (e: KeyPermanentlyInvalidatedException) {
        promise.reject("ERR_KEY_INVALIDATED", "Biometrics changed; the key is no longer valid", e)
      } catch (e: Exception) {
        promise.reject("ERR_KEYSTORE", e.message ?: "keystore error", e)
      }
    }
  }

  // -------------------------------------------------------------------- helpers

  private fun clearNow() {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip()
      else cm.setPrimaryClip(ClipData.newPlainText("", ""))
    } catch (_: SecurityException) {
      // Refused while the app is in the background; retried when it comes back.
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  private fun key(alias: String): SecretKey =
    keyStore().getKey(alias, null) as? SecretKey ?: throw IllegalStateException("no such key: $alias")

  private fun generateKey(alias: String, requireBiometric: Boolean, strongBox: Boolean) {
    val builder = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
    if (requireBiometric) {
      builder.setUserAuthenticationRequired(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      } else {
        @Suppress("DEPRECATION")
        builder.setUserAuthenticationValidityDurationSeconds(-1)
      }
      builder.setInvalidatedByBiometricEnrollment(true)
    }
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setIsStrongBoxBacked(true)
    try {
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
        init(builder.build())
      }.generateKey()
    } catch (e: Exception) {
      // StrongBox is optional hardware; retry in the regular TEE-backed keystore.
      if (strongBox) generateKey(alias, requireBiometric, strongBox = false) else throw e
    }
  }

  /**
   * Runs [cipher] over [input]. Biometric keys (alias starts with "bio.") must be unlocked by a
   * BiometricPrompt bound to this exact cipher; other keys are used directly.
   */
  private fun <T> runCipher(
    alias: String,
    cipher: Cipher,
    input: ByteArray,
    title: String,
    subtitle: String,
    promise: Promise,
    transform: (ByteArray) -> T,
  ) {
    if (!alias.startsWith(BIOMETRIC_PREFIX)) {
      promise.resolve(transform(cipher.doFinal(input)))
      return
    }
    val act = activity as? FragmentActivity
      ?: return promise.reject("ERR_NO_ACTIVITY", "Biometric prompt needs a FragmentActivity", null)
    act.runOnUiThread {
      val executor = ContextCompat.getMainExecutor(act)
      val prompt = BiometricPrompt(
        act,
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            try {
              val c = result.cryptoObject?.cipher ?: cipher
              promise.resolve(transform(c.doFinal(input)))
            } catch (e: Exception) {
              promise.reject("ERR_KEYSTORE", e.message ?: "decryption failed", e)
            }
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            val canceled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
              errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
              errorCode == BiometricPrompt.ERROR_CANCELED
            promise.reject(if (canceled) "ERR_BIOMETRIC_CANCELED" else "ERR_BIOMETRIC", errString.toString(), null)
          }
        },
      )
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(title)
        .setSubtitle(subtitle)
        .setNegativeButtonText("Use master password")
        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
  }

  private companion object {
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val BIOMETRIC_PREFIX = "bio."
  }
}
