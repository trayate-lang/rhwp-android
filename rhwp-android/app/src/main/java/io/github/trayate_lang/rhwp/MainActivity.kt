package io.github.trayate_lang.rhwp

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.print.PrintManager
import android.print.PrintAttributes
import android.webkit.*
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

/** 단일 WebView의 수명을 유지하는 Android 껍데기. 문서 편집은 기존 Studio가 전담한다. */
class MainActivity : ComponentActivity() {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val EDITOR_URL = "$ORIGIN/assets/studio/index.html"
    }
    lateinit var webView: WebView
        private set
    private lateinit var store: DocumentStore
    private val io = Executors.newSingleThreadExecutor()
    private var pickerReply: ((JSONObject?, Exception?) -> Unit)? = null
    private var pendingIntent: Intent? = null
    private var editorReady = false
    private var printWebView: WebView? = null
    private lateinit var assets: WebViewAssetLoader
    private var imageChooser: ValueCallback<Array<Uri>>? = null

    /** 네이티브 선택창 취소는 오류 다운로드로 우회하지 않고 명시적인 취소 응답으로 돌려준다. */
    private val openPicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        completePicker(uri, false)
    }
    private val savePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        completePicker(if (result.resultCode == RESULT_OK) result.data?.data else null, true)
    }
    private val imagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        imageChooser?.onReceiveValue(uri?.let { arrayOf(it) }); imageChooser = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        store = DocumentStore(this)
        assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        webView = WebView(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            addView(webView, LinearLayout.LayoutParams(-1, -1))
        }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val edges = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(edges.left, edges.top, edges.right, edges.bottom)
            insets
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false) // 문서 확대는 Studio의 좌표/커서 모델과 함께 처리한다.
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.webViewClient = localClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams?): Boolean {
                imageChooser?.onReceiveValue(null)
                imageChooser = callback
                imagePicker.launch(params?.acceptTypes?.firstOrNull { it.isNotBlank() } ?: "*/*")
                return true
            }
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("확인") { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show()
                return true
            }
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("확인") { _, _ -> result.confirm() }.setNegativeButton("취소") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show()
                return true
            }
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            AlertDialog.Builder(this).setMessage("Android System WebView를 업데이트한 후 다시 실행해 주세요.").setPositiveButton("닫기") { _, _ -> finish() }.show()
            return
        }
        // 다른 origin과 iframe은 파일 접근 메시지를 보낼 수 없다.
        WebViewCompat.addWebMessageListener(webView, "RhwpNative", setOf(ORIGIN)) { _, message, origin, isMainFrame, reply ->
            if (origin.toString() == ORIGIN && isMainFrame && message.type == WebMessageCompat.TYPE_STRING) handleMessage(message.data ?: "", reply)
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.rhwpAndroid?.requestBack()") { result -> if (result == "null") finish() }
            }
        })
        pendingIntent = intent
        webView.loadUrl(EDITOR_URL)
    }

    /** APK 안의 자산만 읽는다. 오프라인을 깨는 CDN/원격 문서 요청은 네트워크로 흘려보내지 않는다. */
    private fun localClient() = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest): WebResourceResponse? {
            return assets.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", 403, "Offline only", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest): Boolean = request.url.toString() != EDITOR_URL
        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            AlertDialog.Builder(this@MainActivity).setMessage("편집 화면이 종료되었습니다. 다시 시작하면 마지막 자동복구본을 확인할 수 있습니다.").setPositiveButton("다시 시작") { _, _ -> recreate() }.show()
            return true
        }
    }

    private fun handleMessage(raw: String, proxy: JavaScriptReplyProxy) {
        if (raw.length > DocumentStore.CHUNK_BYTES * 2 + 4096) return
        val request = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val id = request.optString("id")
        val args = request.optJSONObject("args") ?: JSONObject()
        val reply: (JSONObject?, Exception?) -> Unit = { value, error ->
            runOnUiThread {
                val response = JSONObject().put("id", id)
                if (error == null) response.put("result", value ?: JSONObject()) else response.put("error", JSONObject()
                    .put("code", (error as? BridgeFailure)?.code ?: "IO_ERROR")
                    .put("message", (error as? BridgeFailure)?.message ?: "파일 작업에 실패했습니다. 위치와 권한을 확인해 주세요."))
                if (!isDestroyed) proxy.postMessage(response.toString())
            }
        }
        try {
            when (request.optString("method")) {
                "ready" -> { editorReady = true; reply(JSONObject(), null); deliverPendingIntent() }
                "open", "pickSave" -> {
                    if (pickerReply != null) throw BridgeFailure("BUSY", "열린 파일 선택창을 먼저 닫아 주세요.")
                    pickerReply = reply
                    if (request.getString("method") == "open") openPicker.launch(arrayOf("*/*"))
                    else savePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = args.optString("mime", "application/octet-stream")
                        putExtra(Intent.EXTRA_TITLE, DocumentStore.safeName(args.optString("name")))
                    })
                }
                "read", "begin", "append", "finish", "abort" -> io.execute {
                    try {
                        val result = when (request.getString("method")) {
                            "read" -> store.readChunk(args); "begin" -> store.begin(args); "append" -> store.append(args)
                            "finish" -> store.finish(args); else -> store.abort(args)
                        }
                        if (result.has("exportId")) {
                            val file = store.exportFile(result.getString("exportId"), result.getString("name"))
                            // 큰 인쇄 HTML 읽기도 작업 스레드에서 처리해 버튼/화면 전환을 막지 않는다.
                            val html = if (result.getString("kind") == "print") file.readText() else null
                            runOnUiThread {
                                try {
                                    if (html != null) printHtml(html, result.getString("name")) else shareFile(file)
                                    reply(result, null)
                                } catch (error: Exception) { reply(null, error) }
                            }
                        } else reply(result, null)
                    } catch (error: Exception) { reply(null, error) }
                }
                "clipboardRead" -> {
                    val clipboard = getSystemService(ClipboardManager::class.java)
                    reply(JSONObject().put("text", clipboard.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString() ?: ""), null)
                }
                "clipboardWrite" -> {
                    getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("", args.getString("text")))
                    reply(JSONObject(), null)
                }
                "close" -> { reply(JSONObject(), null); finish() }
                else -> throw BridgeFailure("UNKNOWN_METHOD", "지원하지 않는 앱 연결 요청입니다.")
            }
        } catch (error: Exception) {
            // 두 번째 열기 요청이 거절돼도 이미 열린 선택창의 응답은 보존한다.
            if (pickerReply === reply) pickerReply = null
            reply(null, error)
        }
    }

    private fun completePicker(uri: Uri?, forSave: Boolean) {
        val reply = pickerReply ?: return
        pickerReply = null
        if (uri == null) { reply(null, BridgeFailure("CANCELLED", "파일 선택을 취소했습니다.")); return }
        // 공급자에 따라 지속 권한을 지원하지 않아도 현재 선택 권한으로는 사용할 수 있다.
        runCatching { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
        io.execute { try { reply(store.register(uri, forSave), null) } catch (error: Exception) { reply(null, error) } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); pendingIntent = intent; deliverPendingIntent() }

    private fun deliverPendingIntent() {
        if (!editorReady) return
        val source = pendingIntent ?: return
        pendingIntent = null
        @Suppress("DEPRECATION")
        val uri = if (source.action == Intent.ACTION_SEND) source.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) else if (source.action == Intent.ACTION_VIEW) source.data else null
        if (uri == null) return
        io.execute {
            try {
                val metadata = store.register(uri)
                runOnUiThread { webView.evaluateJavascript("window.rhwpAndroid?.openIncoming($metadata)", null) }
            } catch (_: Exception) { runOnUiThread { Toast.makeText(this, "파일을 열 수 없습니다. 앱의 파일 열기를 사용해 주세요.", Toast.LENGTH_LONG).show() } }
        }
    }

    private fun shareFile(file: java.io.File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val mime = if (file.extension.lowercase() == "hwpx") "application/hwp+zip" else "application/x-hwp"
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = mime; putExtra(Intent.EXTRA_STREAM, uri); clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "문서 공유"))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun printHtml(html: String, name: String) {
        printWebView?.destroy()
        val view = WebView(this).also { printWebView = it }
        view.settings.javaScriptEnabled = true
        view.settings.allowFileAccess = false
        // 미국 지역 에뮬레이터의 Letter 기본값 대신 편집 문서의 실제 용지를 사용한다.
        val paper = Regex("name=\"rhwp-paper-size\" content=\"([0-9.]+),([0-9.]+)\"").find(html)
        val width = paper?.groupValues?.get(1)?.toDoubleOrNull()?.takeIf { it in 25.0..2000.0 } ?: 210.0
        val height = paper?.groupValues?.get(2)?.toDoubleOrNull()?.takeIf { it in 25.0..2000.0 } ?: 297.0
        val attributes = PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize("rhwp-document", "문서 용지", (width / 25.4 * 1000).toInt(), (height / 25.4 * 1000).toInt()))
            .setMinMargins(PrintAttributes.Margins.NO_MARGINS).build()
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView?, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", 403, "Offline only", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            override fun onPageFinished(v: WebView?, url: String?) { waitForPrintFonts(view, name, 0, attributes) }
        }
        // 인쇄 전용 뷰에는 문서 파일 연결부를 노출하지 않는다.
        view.loadDataWithBaseURL("$ORIGIN/assets/studio/", html, "text/html", "UTF-8", null)
    }

    private fun waitForPrintFonts(view: WebView, name: String, attempts: Int, attributes: PrintAttributes) {
        view.evaluateJavascript("document.fonts.status === 'loaded' && Array.from(document.images).every(i => i.complete)") { status ->
            if (status == "true") getSystemService(PrintManager::class.java).print(name.removeSuffix(".html"), view.createPrintDocumentAdapter(name.removeSuffix(".html")), attributes)
            else if (attempts < 100) view.postDelayed({ waitForPrintFonts(view, name, attempts + 1, attributes) }, 100)
            else Toast.makeText(this, "인쇄 글꼴을 준비하지 못했습니다. 다시 시도해 주세요.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        webView.invalidate(); ViewCompat.requestApplyInsets(webView.parent as android.view.View)
    }
    override fun onPause() { if (::webView.isInitialized) webView.evaluateJavascript("window.rhwpAndroid?.checkpoint()", null); super.onPause() }
    override fun onDestroy() {
        pickerReply?.invoke(null, BridgeFailure("CANCELLED", "화면이 닫혔습니다.")); pickerReply = null
        imageChooser?.onReceiveValue(null); imageChooser = null
        if (::webView.isInitialized) webView.destroy()
        printWebView?.destroy()
        io.execute { if (::store.isInitialized) store.close() }; io.shutdown()
        super.onDestroy()
    }
}
