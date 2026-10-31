package expo.modules.voultnative

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/**
 * Offers Voult logins in other apps and browsers. To keep the screen uncluttered it shows one
 * compact "Voult" suggestion (dropdown row, and a chip above the keyboard when the keyboard
 * supports it); tapping it opens a bottom drawer ([AutofillAuthActivity]) that lists the matching
 * logins, unlocks if needed, and decrypts only the chosen login.
 */
class VoultAutofillService : AutofillService() {
  companion object {
    private val codes = AtomicInteger(1)

    fun presentation(ctx: Context, title: String, subtitle: String): RemoteViews =
      RemoteViews(ctx.packageName, R.layout.voult_autofill_item).apply {
        setTextViewText(R.id.voult_title, title)
        setTextViewText(R.id.voult_subtitle, subtitle)
        setViewVisibility(R.id.voult_subtitle, if (subtitle.isEmpty()) 8 else 0)
      }
  }

  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    val fields = FieldParser.parse(request.fillContexts.last().structure)
    // Never offer to fill Voult's own screens (the master password is not for autofill).
    if (fields == null || fields.packageName == packageName) return callback.onSuccess(null)

    val index = AutofillIndex.load(this)
    val matches = when {
      fields.webHost != null -> index.forWeb(fields.webHost, fields.webScheme)
      fields.packageName != null -> index.forPackage(fields.packageName)
      else -> emptyList()
    }
    val subtitle = when {
      fields.signUp -> "Sign up with Voult"
      matches.isEmpty() -> "Search your vault"
      matches.size == 1 -> matches[0].optString("username").ifEmpty { matches[0].optString("title") }
      else -> "${matches.size} logins"
    }

    val inline = if (Build.VERSION.SDK_INT >= 30) request.inlineSuggestionsRequest else null
    val response = FillResponse.Builder().addDataset(dataset(fields, "Voult", subtitle, inline))
    // Offer to save what the user typed once they submit a form with a password.
    if (fields.password != null) {
      val required = listOfNotNull(fields.password, fields.username).toTypedArray()
      response.setSaveInfo(
        SaveInfo.Builder(
          SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD,
          required,
        ).setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE).build(),
      )
    }
    callback.onSuccess(response.build())
  }

  private fun dataset(
    f: ParsedFields,
    title: String,
    subtitle: String,
    inline: InlineSuggestionsRequest?,
  ): Dataset {
    val intent = Intent(this, AutofillAuthActivity::class.java)
      .putExtra(AutofillAuthActivity.EXTRA_USERNAME_ID, f.username)
      .putExtra(AutofillAuthActivity.EXTRA_PASSWORD_ID, f.password)
      .putExtra(AutofillAuthActivity.EXTRA_HOST, f.webHost)
      .putExtra(AutofillAuthActivity.EXTRA_PACKAGE, f.packageName)
      .putExtra(AutofillAuthActivity.EXTRA_SIGNUP, f.signUp)
    // The system adds its own extras, so the intent must be mutable.
    val flags = PendingIntent.FLAG_CANCEL_CURRENT or
      (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    val pending = PendingIntent.getActivity(this, codes.getAndIncrement(), intent, flags)

    @Suppress("DEPRECATION")
    val ds = Dataset.Builder(presentation(this, title, subtitle))
    ds.setAuthentication(pending.intentSender)
    // Placeholders: the real values arrive from the auth activity.
    val ids: List<AutofillId> = listOfNotNull(f.username, f.password)
    @Suppress("DEPRECATION")
    for (id in ids) ds.setValue(id, null)

    if (Build.VERSION.SDK_INT >= 30 && inline != null) {
      val spec = inline.inlinePresentationSpecs.firstOrNull()
      if (spec != null && UiVersions.getVersions(spec.style).contains(UiVersions.INLINE_UI_VERSION_1)) {
        try {
          val content = InlineSuggestionUi.newContentBuilder(pending)
            .setTitle(title)
            .setSubtitle(subtitle)
            .setStartIcon(Icon.createWithResource(this, R.drawable.voult_autofill_icon))
            .build()
          ds.setInlinePresentation(InlinePresentation(content.slice, spec, false))
        } catch (_: Exception) {
          // The dropdown row still works.
        }
      }
    }
    return ds.build()
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val fields = FieldParser.parse(request.fillContexts.last().structure)
    if (fields == null || fields.passwordValue.isEmpty() || fields.packageName == packageName) {
      return callback.onSuccess()
    }
    DeviceVault.write(
      this,
      DeviceVault.PENDING_SAVE,
      JSONObject()
        .put("username", fields.usernameValue)
        .put("password", fields.passwordValue)
        .put("host", fields.webHost)
        .put("package", fields.packageName)
        .put("at", System.currentTimeMillis())
        .toString(),
    )
    // Open the app so the user can confirm; if the system refuses a background launch the login
    // stays queued (encrypted) and the app offers it the next time it is opened.
    try {
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    } catch (_: Exception) {
      // Queued above.
    }
    callback.onSuccess()
  }
}
