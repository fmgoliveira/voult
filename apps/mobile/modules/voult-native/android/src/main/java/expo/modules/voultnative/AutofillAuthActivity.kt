package expo.modules.voultnative

import android.app.Activity
import android.content.Intent
import android.service.autofill.Dataset
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import org.json.JSONObject

/**
 * Shown over the app being filled when the user picks a Voult suggestion. The JS side unlocks the
 * vault if needed, finds (or lets the user pick) the login, and hands back the values; the
 * decrypted password never exists in Kotlin before this point.
 */
class AutofillAuthActivity : VoultReactActivity() {
  companion object {
    const val EXTRA_SIGNUP = "voult.signup"
    const val EXTRA_USERNAME_ID = "voult.usernameId"
    const val EXTRA_PASSWORD_ID = "voult.passwordId"
    const val EXTRA_HOST = "voult.host"
    const val EXTRA_PACKAGE = "voult.package"
  }

  @Suppress("DEPRECATION")
  private fun id(name: String): AutofillId? = intent.getParcelableExtra(name)

  override fun launchRequest(): String {
    val pkg = intent.getStringExtra(EXTRA_PACKAGE)
    val host = intent.getStringExtra(EXTRA_HOST)
    return JSONObject()
      .put("kind", "fill")
      .put("signUp", intent.getBooleanExtra(EXTRA_SIGNUP, false))
      .put("host", host)
      .put("package", pkg)
      .put("label", host ?: appLabel(pkg))
      .put("wantsUsername", id(EXTRA_USERNAME_ID) != null)
      .put("wantsPassword", id(EXTRA_PASSWORD_ID) != null)
      .toString()
  }

  private fun appLabel(pkg: String?): String? =
    try {
      if (pkg == null) null
      else packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
      pkg
    }

  override fun complete(result: String?) {
    runOnUiThread {
      if (result == null) {
        setResult(Activity.RESULT_CANCELED)
      } else {
        val values = JSONObject(result)
        val ds = Dataset.Builder(VoultAutofillService.presentation(this, "Voult", ""))
        var any = false
        id(EXTRA_USERNAME_ID)?.let {
          ds.setValue(it, AutofillValue.forText(values.optString("username")))
          any = true
        }
        id(EXTRA_PASSWORD_ID)?.let {
          ds.setValue(it, AutofillValue.forText(values.optString("password")))
          any = true
        }
        if (any) {
          setResult(
            Activity.RESULT_OK,
            Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, ds.build()),
          )
        } else {
          setResult(Activity.RESULT_CANCELED)
        }
      }
      finish()
    }
  }
}
