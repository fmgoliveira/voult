package expo.modules.voultnative

import android.app.assist.AssistStructure
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId

/** The login fields found on a screen, and where it came from. */
class ParsedFields(
  val username: AutofillId?,
  val password: AutofillId?,
  val usernameValue: String,
  val passwordValue: String,
  val webHost: String?,
  val webScheme: String?,
  val packageName: String?,
  /** Looks like a registration form (new/confirm password), not a sign-in. */
  val signUp: Boolean,
)

object FieldParser {
  private enum class Kind { USERNAME, PASSWORD }

  private class Field(val node: AssistStructure.ViewNode, val kind: Kind?)

  private val USER_WORDS = Regex("user|e-?mail|login|identifier|account", RegexOption.IGNORE_CASE)

  fun parse(structure: AssistStructure): ParsedFields? {
    val fields = ArrayList<Field>()
    var host: String? = null
    var scheme: String? = null
    for (i in 0 until structure.windowNodeCount) {
      walk(structure.getWindowNodeAt(i).rootViewNode, fields) { d, s ->
        if (host == null && !d.isNullOrBlank()) {
          host = d
          scheme = s
        }
      }
    }
    val pkg = structure.activityComponent?.packageName
    val passwordCount = fields.count { it.kind == Kind.PASSWORD }
    val passwordAt = fields.indexOfFirst { it.kind == Kind.PASSWORD }
    val password = if (passwordAt >= 0) fields[passwordAt] else null
    // Multi-step logins: a username-only screen still gets a username.
    val username = if (password != null) {
      val before = fields.subList(0, passwordAt)
      // A plain text box right before the password is the username even without any hint.
      before.lastOrNull { it.kind == Kind.USERNAME } ?: before.lastOrNull { it.kind == null }
    } else {
      fields.firstOrNull { it.node.isFocused && it.kind == Kind.USERNAME }
        ?: fields.firstOrNull { it.kind == Kind.USERNAME }
    }
    if (username == null && password == null) return null
    val signUp = passwordCount >= 2 || fields.any { it.kind == Kind.PASSWORD && isNewPassword(it.node) }
    fun text(f: Field?) = f?.node?.autofillValue?.takeIf { it.isText }?.textValue?.toString() ?: ""
    return ParsedFields(
      username?.node?.autofillId,
      password?.node?.autofillId,
      text(username),
      text(password),
      host?.lowercase(),
      scheme,
      pkg,
      signUp,
    )
  }

  private fun walk(
    node: AssistStructure.ViewNode,
    out: MutableList<Field>,
    web: (String?, String?) -> Unit,
  ) {
    web(node.webDomain, if (Build.VERSION.SDK_INT >= 28) node.webScheme else null)
    val kind = classify(node)
    if (kind != null || isPlainText(node)) out.add(Field(node, kind))
    for (i in 0 until node.childCount) walk(node.getChildAt(i), out, web)
  }

  private val NEW_WORDS = Regex("new|confirm|repeat|retype|create", RegexOption.IGNORE_CASE)

  private fun isNewPassword(n: AssistStructure.ViewNode): Boolean {
    if (n.autofillHints?.any { it.equals("newPassword", true) } == true) return true
    val ac = n.htmlInfo?.attributes?.firstOrNull { it.first.equals("autocomplete", true) }?.second
    if (ac?.contains("new-password", true) == true) return true
    return NEW_WORDS.containsMatchIn("${n.idEntry.orEmpty()} ${n.hint.orEmpty()}")
  }

  /** A visible, single-line text box that is not a password. */
  private fun isPlainText(n: AssistStructure.ViewNode): Boolean =
    n.autofillId != null &&
      n.autofillType == View.AUTOFILL_TYPE_TEXT &&
      n.visibility == View.VISIBLE &&
      n.inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT

  private fun classify(n: AssistStructure.ViewNode): Kind? {
    if (n.autofillId == null || n.autofillType != View.AUTOFILL_TYPE_TEXT) return null
    if (n.visibility != View.VISIBLE) return null

    n.autofillHints?.forEach { h ->
      when (h.lowercase()) {
        "password", "newpassword" -> return Kind.PASSWORD
        "username", "emailaddress", "email" -> return Kind.USERNAME
      }
    }

    val html = n.htmlInfo
    if (html != null && html.tag.equals("input", true)) {
      val attrs = html.attributes?.associate { it.first.lowercase() to it.second.lowercase() }.orEmpty()
      val ac = attrs["autocomplete"].orEmpty()
      if (attrs["type"] == "password" || ac.contains("password")) return Kind.PASSWORD
      if (ac.contains("username") || ac.contains("email") || attrs["type"] == "email") {
        return Kind.USERNAME
      }
    }

    val type = n.inputType
    if (type and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT) {
      when (type and InputType.TYPE_MASK_VARIATION) {
        InputType.TYPE_TEXT_VARIATION_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD -> return Kind.PASSWORD
        InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
        InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS -> return Kind.USERNAME
      }
      val label = "${n.idEntry.orEmpty()} ${n.hint.orEmpty()}"
      if (USER_WORDS.containsMatchIn(label)) return Kind.USERNAME
    }
    return null
  }
}
