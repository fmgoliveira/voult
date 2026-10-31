package expo.modules.voultnative

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Read side of the index the app writes (see `buildAutofillIndex` in @voult/core). */
class AutofillIndex(private val root: JSONObject) {
  companion object {
    fun load(ctx: Context): AutofillIndex {
      val json = DeviceVault.read(ctx, DeviceVault.INDEX)
      val root = try {
        if (json != null) JSONObject(json) else JSONObject()
      } catch (_: Exception) {
        JSONObject()
      }
      return AutofillIndex(root)
    }

    private val LOOPBACK = setOf("localhost", "127.0.0.1")
  }

  private fun JSONObject.strings(key: String): List<String> {
    val a = optJSONArray(key) ?: return emptyList()
    return (0 until a.length()).map { a.optString(it) }
  }

  private fun objects(key: String): List<JSONObject> {
    val a: JSONArray = root.optJSONArray(key) ?: return emptyList()
    return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
  }

  /** Logins for a web page: https only (http just on loopback), honouring "never" hosts. */
  fun forWeb(host: String, scheme: String?): List<JSONObject> {
    val h = host.lowercase()
    if (scheme == "http" && h !in LOOPBACK) return emptyList()
    return objects("logins").filter { l ->
      if (l.strings("never").contains(h)) return@filter false
      l.strings("hosts").contains(h) || l.strings("domains").any { h == it || h.endsWith(".$it") }
    }
  }

  fun forPackage(pkg: String): List<JSONObject> =
    objects("logins").filter { it.strings("packages").contains(pkg) }

  fun passkeys(rpId: String, allowed: Set<String>): List<JSONObject> =
    objects("passkeys").filter {
      it.optString("rpId") == rpId &&
        (allowed.isEmpty() || allowed.contains(it.optString("credentialId")))
    }
}
