package expo.modules.voultnative

import android.app.Activity
import android.content.Intent
import android.util.Base64
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PasswordCredential
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.provider.CallingAppInfo
import androidx.credentials.provider.PendingIntentHandler
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Opened by Credential Manager when the user picks Voult to create a passkey/password or to sign
 * in. Kotlin gathers who is asking (including proof of the caller's identity); the JS side shows
 * the confirmation, does the cryptography and returns the response JSON.
 */
class CredentialActivity : VoultReactActivity() {
  companion object {
    const val EXTRA_KIND = "voult.kind"
    const val EXTRA_ITEM = "voult.item"
    const val EXTRA_CREDENTIAL = "voult.credential"
  }

  private var cached: String? = null
  private var creating = false

  private fun b64(bytes: ByteArray) =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  override fun launchRequest(): String = cached ?: build().also { cached = it }

  private fun build(): String {
    val out = JSONObject()
    var info: CallingAppInfo? = null
    var rpId = ""
    var clientDataHash: ByteArray? = null

    if (intent.getStringExtra(EXTRA_KIND) == "create") {
      creating = true
      val req = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
        ?: return out.put("error", "no_request").toString()
      info = req.callingAppInfo
      out.put("op", "create")
      when (val call = req.callingRequest) {
        is CreatePublicKeyCredentialRequest -> {
          out.put("type", "passkey").put("requestJson", call.requestJson)
          clientDataHash = call.clientDataHash
          rpId = JSONObject(call.requestJson).optJSONObject("rp")?.optString("id").orEmpty()
        }
        is CreatePasswordRequest -> out.put("type", "password").put("id", call.id).put("password", call.password)
        else -> return out.put("error", "unsupported").toString()
      }
    } else {
      val req = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
        ?: return out.put("error", "no_request").toString()
      info = req.callingAppInfo
      out.put("op", "get")
        .put("itemId", intent.getStringExtra(EXTRA_ITEM))
        .put("credentialId", intent.getStringExtra(EXTRA_CREDENTIAL))
      val wantsPasskey = !intent.getStringExtra(EXTRA_CREDENTIAL).isNullOrEmpty()
      val option = req.credentialOptions.filterIsInstance<GetPublicKeyCredentialOption>().firstOrNull()
      if (wantsPasskey && option != null) {
        out.put("type", "passkey").put("requestJson", option.requestJson)
        clientDataHash = option.clientDataHash
        rpId = JSONObject(option.requestJson).optString("rpId")
      } else {
        out.put("type", "password")
      }
    }

    clientDataHash?.let { out.put("clientDataHash", b64(it)) }
    val pkg = info?.packageName.orEmpty()
    out.put("callerPackage", pkg).put("callerLabel", label(pkg))

    if (out.optString("type") == "passkey" && info != null) {
      val origin = try {
        info.getOrigin(assets.open("privileged_browsers.json").bufferedReader().use { it.readText() })
      } catch (_: Exception) {
        null
      }
      if (origin != null) {
        out.put("privileged", true).put("origin", origin)
      } else {
        // A native app: it is identified by its signing certificate, and must be linked to the
        // website through Digital Asset Links.
        val cert = signingCertificate(info)
        out.put("privileged", false)
        if (cert != null) {
          val digest = MessageDigest.getInstance("SHA-256").digest(cert)
          out.put("certSha256", b64(digest))
          out.put("verified", AssetLinks.verifies(rpId, pkg, AssetLinks.fingerprint(cert)))
        } else {
          out.put("verified", false)
        }
      }
    }
    return out.toString()
  }

  @Suppress("DEPRECATION")
  private fun signingCertificate(info: CallingAppInfo): ByteArray? {
    val si = info.signingInfo
    val certs = if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
    return certs?.lastOrNull()?.toByteArray()
  }

  private fun label(pkg: String): String =
    try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }

  override fun complete(result: String?) {
    runOnUiThread {
      val data = Intent()
      val r = result?.let { JSONObject(it) }
      val passkey = r?.optString("type") == "passkey"
      if (creating) {
        when {
          r == null -> PendingIntentHandler.setCreateCredentialException(data, CreateCredentialCancellationException())
          passkey -> PendingIntentHandler.setCreateCredentialResponse(
            data,
            CreatePublicKeyCredentialResponse(r.getString("response")),
          )
          else -> PendingIntentHandler.setCreateCredentialResponse(data, CreatePasswordResponse())
        }
      } else {
        when {
          r == null -> PendingIntentHandler.setGetCredentialException(data, GetCredentialCancellationException())
          passkey -> PendingIntentHandler.setGetCredentialResponse(
            data,
            GetCredentialResponse(PublicKeyCredential(r.getString("response"))),
          )
          else -> PendingIntentHandler.setGetCredentialResponse(
            data,
            GetCredentialResponse(PasswordCredential(r.getString("id"), r.getString("password"))),
          )
        }
      }
      setResult(Activity.RESULT_OK, data)
      finish()
    }
  }
}
