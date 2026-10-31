package expo.modules.voultnative

import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/** An activity opened by the system (autofill or credential picker) and answered by the JS side. */
interface LaunchActivity {
  /** What was asked, as JSON for the JS side. May do blocking work: call off the main thread. */
  fun launchRequest(): String

  /** The JS answer, or null if the user cancelled. */
  fun complete(result: String?)
}

object Launch {
  @Volatile
  var current: LaunchActivity? = null
}

/**
 * Hosts the "VoultAutofill" React root (registered in apps/mobile/index.ts) inside the app's one
 * React instance: when the app is already running and unlocked there is nothing to wait for, and
 * on a cold start the same JavaScript bundle boots here.
 */
abstract class VoultReactActivity : ReactActivity(), LaunchActivity {
  override fun onCreate(savedInstanceState: Bundle?) {
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    super.onCreate(null)
    Launch.current = this
  }

  override fun onDestroy() {
    if (Launch.current === this) Launch.current = null
    super.onDestroy()
  }

  override fun getMainComponentName(): String = "VoultAutofill"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
