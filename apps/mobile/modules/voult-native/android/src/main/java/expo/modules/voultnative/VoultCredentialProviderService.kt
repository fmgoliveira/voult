package expo.modules.voultnative

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePasswordCredentialRequest
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

/**
 * Passkeys and passwords through Android's Credential Manager (Android 14+). Like autofill it
 * only lists what the index says exists; [CredentialActivity] does the unlock and the crypto.
 */
@RequiresApi(34)
class VoultCredentialProviderService : CredentialProviderService() {
  private val codes = AtomicInteger(1000)

  private fun icon() = Icon.createWithResource(this, R.drawable.voult_autofill_icon)

  private fun pending(configure: Intent.() -> Unit): PendingIntent {
    val intent = Intent(this, CredentialActivity::class.java).apply(configure)
    // The system adds the request to the intent, so it must be mutable.
    return PendingIntent.getActivity(
      this,
      codes.getAndIncrement(),
      intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    val description = when (request) {
      is BeginCreatePublicKeyCredentialRequest -> "Save this passkey in Voult"
      is BeginCreatePasswordCredentialRequest -> "Save this password in Voult"
      else -> return callback.onError(CreateCredentialUnknownException())
    }
    val entry = CreateEntry.Builder("Voult", pending { putExtra(CredentialActivity.EXTRA_KIND, "create") })
      .setDescription(description)
      .setIcon(icon())
      .build()
    callback.onResult(BeginCreateCredentialResponse.Builder().addCreateEntry(entry).build())
  }

  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    val index = AutofillIndex.load(this)
    val entries = ArrayList<CredentialEntry>()
    val callerPackage = request.callingAppInfo?.packageName

    for (option in request.beginGetCredentialOptions) {
      when (option) {
        is BeginGetPublicKeyCredentialOption -> {
          val json = try {
            JSONObject(option.requestJson)
          } catch (_: Exception) {
            continue
          }
          val allow = json.optJSONArray("allowCredentials")
          val allowed = if (allow == null) emptySet() else
            (0 until allow.length()).mapNotNull { allow.optJSONObject(it)?.optString("id") }.toSet()
          for (p in index.passkeys(json.optString("rpId"), allowed)) {
            val user = p.optString("userName").ifBlank { p.optString("title") }
            entries.add(
              PublicKeyCredentialEntry.Builder(
                this,
                user,
                pending {
                  putExtra(CredentialActivity.EXTRA_KIND, "get")
                  putExtra(CredentialActivity.EXTRA_ITEM, p.optString("itemId"))
                  putExtra(CredentialActivity.EXTRA_CREDENTIAL, p.optString("credentialId"))
                },
                option,
              )
                .setDisplayName(p.optString("title"))
                .setLastUsedTime(Instant.ofEpochMilli(p.optLong("createdAt")))
                .setIcon(icon())
                .build(),
            )
          }
        }

        is BeginGetPasswordOption -> {
          if (callerPackage == null) continue
          for (l in index.forPackage(callerPackage)) {
            val user = l.optString("username").ifBlank { l.optString("title") }
            entries.add(
              PasswordCredentialEntry.Builder(
                this,
                user,
                pending {
                  putExtra(CredentialActivity.EXTRA_KIND, "get")
                  putExtra(CredentialActivity.EXTRA_ITEM, l.optString("id"))
                },
                option,
              )
                .setDisplayName(l.optString("title"))
                .setIcon(icon())
                .build(),
            )
          }
        }

        else -> Unit
      }
    }
    callback.onResult(BeginGetCredentialResponse.Builder().setCredentialEntries(entries).build())
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    callback.onResult(null)
  }
}
