package expo.modules.voultnative

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Digital Asset Links: a native app may only use a website's passkeys if that site's
 * /.well-known/assetlinks.json lists the app (package + signing certificate) for sign-in.
 */
object AssetLinks {
  private const val RELATION = "delegate_permission/common.get_login_creds"

  fun fingerprint(cert: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(cert).joinToString(":") { "%02X".format(it) }

  /** Blocking network call; run off the main thread. */
  fun verifies(rpId: String, packageName: String, certFingerprint: String): Boolean {
    if (rpId.isEmpty() || rpId.contains('/') || rpId.contains(':')) return false
    return try {
      val conn = URL("https://$rpId/.well-known/assetlinks.json").openConnection() as HttpURLConnection
      conn.connectTimeout = 5000
      conn.readTimeout = 5000
      conn.instanceFollowRedirects = false // the spec forbids redirects here
      if (conn.responseCode != 200) return false
      val body = conn.inputStream.use { it.readBytes().take(1_000_000).toByteArray() }
      val statements = JSONArray(String(body, Charsets.UTF_8))
      (0 until statements.length()).any { i ->
        val s = statements.optJSONObject(i) ?: return@any false
        val relations = s.optJSONArray("relation") ?: return@any false
        val target = s.optJSONObject("target") ?: return@any false
        val hasRelation = (0 until relations.length()).any { relations.optString(it) == RELATION }
        val prints = target.optJSONArray("sha256_cert_fingerprints")
        hasRelation &&
          target.optString("namespace") == "android_app" &&
          target.optString("package_name") == packageName &&
          prints != null &&
          (0 until prints.length()).any { prints.optString(it).equals(certFingerprint, true) }
      }
    } catch (_: Exception) {
      false
    }
  }
}
