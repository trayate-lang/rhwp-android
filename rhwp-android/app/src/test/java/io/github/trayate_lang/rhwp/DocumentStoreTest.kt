package io.github.trayate_lang.rhwp

import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.io.File
import java.io.FileNotFoundException

/** 테스트 공급자도 실제 파일 디스크립터를 쓴다. SAF 읽기/쓰기 경계의 실패를 재현한다. */
class TestDocumentProvider : ContentProvider() {
    lateinit var file: File
    var rejectWrite = false
    override fun onCreate() = true
    override fun getType(uri: Uri) = "application/x-hwp"
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
        MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf("테스트.hwp")) }
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (rejectWrite && mode.contains('w')) throw FileNotFoundException("test read-only")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode))
    }
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DocumentStoreTest {
    private lateinit var store: DocumentStore
    private lateinit var provider: TestDocumentProvider
    private val uri = Uri.parse("content://rhwp.test/document/1")
    private lateinit var handle: String

    @Before fun prepare() {
        val context = RuntimeEnvironment.getApplication()
        provider = TestDocumentProvider().apply {
            file = File.createTempFile("rhwp-test-", ".hwp", context.cacheDir)
            file.writeText("original")
            attachInfo(context, ProviderInfo().apply { authority = "rhwp.test"; exported = true })
        }
        ShadowContentResolver.registerProviderInternal("rhwp.test", provider)
        store = DocumentStore(context)
        handle = store.register(uri).getString("handle")
    }
    @After fun cleanup() { store.close(); provider.file.delete() }

    private fun begin(bytes: ByteArray): String = store.begin(JSONObject().put("kind", "save").put("handle", handle).put("size", bytes.size)).getString("transfer")
    private fun append(id: String, bytes: ByteArray, offset: Int = 0) = store.append(JSONObject().put("transfer", id).put("offset", offset).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
    private fun finish(id: String) = store.finish(JSONObject().put("transfer", id))
    private fun expectFailure(code: String, action: () -> Unit) {
        val error = assertThrows(BridgeFailure::class.java) { action() }
        assertEquals(code, error.code)
    }

    @Test fun savesAndReadsBackExactBytes() {
        val bytes = "한글 편집 결과\u0000".toByteArray()
        val id = begin(bytes); append(id, bytes)
        assertEquals(bytes.size.toLong(), finish(id).getLong("size"))
        assertArrayEquals(bytes, provider.file.readBytes())
        val read = store.readChunk(JSONObject().put("handle", handle).put("offset", 0).put("length", bytes.size))
        assertArrayEquals(bytes, Base64.decode(read.getString("data"), Base64.NO_WRAP))
    }

    @Test fun incompleteTransferDoesNotTruncateOriginal() {
        val id = begin("longer".toByteArray()); append(id, "part".toByteArray())
        expectFailure("INCOMPLETE_WRITE") { finish(id) }
        assertEquals("original", provider.file.readText())
    }

    @Test fun wrongChunkOrderIsRejectedBeforeOriginalWrite() {
        val id = begin("data".toByteArray())
        expectFailure("INVALID_OFFSET") { append(id, "data".toByteArray(), 1) }
        store.abort(JSONObject().put("transfer", id))
        assertEquals("original", provider.file.readText())
    }

    @Test fun readOnlyFailureKeepsOriginalAndReportsFailure() {
        provider.rejectWrite = true
        val id = begin("data".toByteArray()); append(id, "data".toByteArray())
        expectFailure("WRITE_FAILED") { finish(id) }
        assertEquals("original", provider.file.readText())
    }

    @Test fun externalModificationIsNotOverwritten() {
        val id = begin("data".toByteArray()); append(id, "data".toByteArray())
        provider.file.writeText("changed by another app")
        expectFailure("EXTERNAL_CHANGE") { finish(id) }
        assertEquals("changed by another app", provider.file.readText())
    }

    @Test fun savePickerReturnsSameIdentityForSameDocument() {
        assertEquals(handle, store.register(uri, true).getString("handle"))
    }
}
