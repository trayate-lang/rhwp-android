package io.github.trayate_lang.rhwp

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID

/** 웹에는 실제 파일 경로/URI 대신 임의의 핸들만 전달한다. 모든 호출은 전용 I/O 스레드에서 실행한다. */
class DocumentStore(private val context: Context) {
    companion object {
        const val MAX_BYTES = 128L * 1024 * 1024
        const val CHUNK_BYTES = 256 * 1024

        /** 외부 파일명이 앱 내부 디렉터리 경로로 해석되지 않도록 제한한다. */
        fun safeName(value: String): String = value.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[\\p{Cntrl}]"), "_").take(180).ifBlank { "document.hwp" }
    }

    private data class Document(val uri: Uri, val name: String, var snapshot: File?)
    private data class Transfer(val file: File, val expected: Long, val handle: String?, val kind: String, val name: String)
    private val documents = linkedMapOf<String, Document>()
    private val transfers = mutableMapOf<String, Transfer>()
    private val staging = File(context.cacheDir, "document-io").apply { mkdirs() }

    /** SAF가 허용한 URI를 보관하고, 읽기는 한 번 복사해 큰 문서도 작은 조각으로 전달한다. */
    fun register(uri: Uri, forSave: Boolean = false): JSONObject {
        if (uri.scheme != "content") throw BridgeFailure("INVALID_URI", "Android 파일 선택창에서 문서를 선택해 주세요.")
        // 같은 URI를 저장창에서 다시 골라도 동일 파일이라는 사실과 이전 복구 사본을 유지한다.
        if (forSave) documents.entries.firstOrNull { it.value.uri == uri }?.let {
            return JSONObject().put("handle", it.key).put("name", it.value.name).put("size", it.value.snapshot?.length() ?: 0)
        }
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) safeName(it.getString(0)) else "document.hwp"
        } ?: "document.hwp"
        val snapshot = if (forSave) null else File.createTempFile("read-", ".bin", staging).also { file ->
            try { context.contentResolver.openInputStream(uri)!!.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(CHUNK_BYTES)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_BYTES) throw BridgeFailure("TOO_LARGE", "128MB 이하 문서를 선택해 주세요.")
                        output.write(buffer, 0, count)
                    }
                }
            } } catch (error: Exception) { file.delete(); throw error }
        }
        val id = UUID.randomUUID().toString()
        documents[id] = Document(uri, name, snapshot)
        // 편집기는 한 문서씩 연다. 이전 세션 임시 파일의 무제한 누적을 막는다.
        if (documents.size > 16) documents.remove(documents.keys.first())?.snapshot?.delete()
        return JSONObject().put("handle", id).put("name", name).put("size", snapshot?.length() ?: 0)
    }

    fun readChunk(args: JSONObject): JSONObject {
        val document = documents[args.getString("handle")] ?: throw BridgeFailure("STALE_HANDLE", "파일을 다시 열어 주세요.")
        val file = document.snapshot ?: throw BridgeFailure("NOT_READABLE", "아직 저장한 파일이 아닙니다.")
        val offset = args.getLong("offset")
        val count = args.optInt("length", CHUNK_BYTES).coerceIn(1, CHUNK_BYTES)
        if (offset < 0 || offset > file.length()) throw BridgeFailure("INVALID_OFFSET", "파일 읽기 위치가 올바르지 않습니다.")
        val bytes = ByteArray(minOf(count.toLong(), file.length() - offset).toInt())
        RandomAccessFile(file, "r").use { it.seek(offset); it.readFully(bytes) }
        return JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    /** 파일 선택 후에도 원본을 바로 열어 자르지 않는다. 전체 내보내기 데이터를 먼저 임시 파일에 모은다. */
    fun begin(args: JSONObject): JSONObject {
        val size = args.getLong("size")
        if (size < 1 || size > MAX_BYTES) throw BridgeFailure("TOO_LARGE", "저장할 문서는 1바이트 이상 128MB 이하여야 합니다.")
        if (transfers.size >= 2) throw BridgeFailure("BUSY", "이전 저장이 끝난 뒤 다시 시도해 주세요.")
        val handle = args.optString("handle").takeIf { it.isNotEmpty() }
        if (handle != null && !documents.containsKey(handle)) throw BridgeFailure("STALE_HANDLE", "저장 위치를 다시 선택해 주세요.")
        val kind = args.optString("kind", "save")
        if (kind !in setOf("save", "share", "print")) throw BridgeFailure("INVALID_KIND", "지원하지 않는 내보내기입니다.")
        if (kind == "save" && handle == null) throw BridgeFailure("INVALID_HANDLE", "저장 위치가 없습니다.")
        val id = UUID.randomUUID().toString()
        transfers[id] = Transfer(File.createTempFile("write-", ".bin", staging), size, handle, kind, safeName(args.optString("name")))
        return JSONObject().put("transfer", id)
    }

    fun append(args: JSONObject): JSONObject {
        val transfer = transfers[args.getString("transfer")] ?: throw BridgeFailure("STALE_TRANSFER", "저장을 다시 시작해 주세요.")
        val encoded = args.getString("data")
        if (encoded.length > CHUNK_BYTES * 2) throw BridgeFailure("TOO_LARGE", "저장 조각이 너무 큽니다.")
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        if (bytes.size > CHUNK_BYTES || args.getLong("offset") != transfer.file.length() || transfer.file.length() + bytes.size > transfer.expected)
            throw BridgeFailure("INVALID_OFFSET", "저장 데이터 순서 또는 길이가 올바르지 않습니다.")
        transfer.file.appendBytes(bytes)
        return JSONObject().put("written", transfer.file.length())
    }

    /** 완료 응답은 쓰기·닫기·재읽기 검증 이후에만 반환한다. 실패 시 이전 읽기 사본으로 복구를 시도한다. */
    fun finish(args: JSONObject): JSONObject {
        val id = args.getString("transfer")
        val transfer = transfers.remove(id) ?: throw BridgeFailure("STALE_TRANSFER", "저장을 다시 시작해 주세요.")
        if (transfer.file.length() != transfer.expected) {
            transfer.file.delete()
            throw BridgeFailure("INCOMPLETE_WRITE", "일부 데이터가 누락되어 저장하지 않았습니다.")
        }
        if (transfer.kind != "save") {
            val directory = File(context.cacheDir, "exports/$id").apply { mkdirs() }
            val file = File(directory, transfer.name)
            transfer.file.copyTo(file)
            transfer.file.delete()
            return JSONObject().put("kind", transfer.kind).put("exportId", id).put("name", transfer.name)
        }
        val document = documents[transfer.handle] ?: throw BridgeFailure("STALE_HANDLE", "저장 위치가 만료되었습니다.")
        // 다른 앱에서 바뀐 파일은 예전 사본으로 덮어쓰거나 복원하지 않는다.
        document.snapshot?.let { previous ->
            val unchanged = runCatching {
                val original = previous.inputStream().use { digest(it) }
                val current = context.contentResolver.openInputStream(document.uri)!!.use { digest(it) }
                original.contentEquals(current)
            }.getOrDefault(false)
            if (!unchanged) {
                transfer.file.delete()
                throw BridgeFailure("EXTERNAL_CHANGE", "원본이 바뀌었거나 읽을 수 없습니다. 다른 이름으로 저장해 주세요.")
            }
        }
        try {
            writeUri(document.uri, transfer.file)
            val expectedHash = transfer.file.inputStream().use { digest(it) }
            val actualHash = context.contentResolver.openInputStream(document.uri)!!.use { digest(it) }
            if (!expectedHash.contentEquals(actualHash)) throw BridgeFailure("VERIFY_FAILED", "저장한 파일을 다시 읽어 확인하지 못했습니다.")
            document.snapshot?.delete()
            document.snapshot = transfer.file
            return JSONObject().put("name", document.name).put("size", transfer.expected)
        } catch (error: Exception) {
            val restored = document.snapshot?.let { previous -> runCatching { writeUri(document.uri, previous) }.isSuccess } ?: false
            transfer.file.delete()
            throw BridgeFailure("WRITE_FAILED", if (restored) "저장에 실패해 이전 내용을 복원했습니다. 다른 이름으로 저장해 주세요." else "저장에 실패했습니다. 편집 내용은 유지됩니다. 다른 이름으로 저장하고 대상 파일을 확인해 주세요.")
        }
    }

    fun abort(args: JSONObject): JSONObject {
        transfers.remove(args.getString("transfer"))?.file?.delete()
        return JSONObject()
    }

    fun exportFile(id: String, name: String): File {
        if (!Regex("[a-f0-9-]{36}").matches(id)) throw BridgeFailure("INVALID_EXPORT", "잘못된 내보내기입니다.")
        return File(context.cacheDir, "exports/$id/${safeName(name)}")
    }

    private fun writeUri(uri: Uri, source: File) {
        context.contentResolver.openOutputStream(uri, "wt")?.use { output ->
            source.inputStream().use { it.copyTo(output) }
            output.flush()
        } ?: throw BridgeFailure("NOT_WRITABLE", "이 위치에 파일을 쓸 수 없습니다.")
    }

    private fun digest(input: java.io.InputStream): ByteArray {
        val hash = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(CHUNK_BYTES)
        while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
        return hash.digest()
    }

    /** Activity 종료 때 앱 전용 I/O 임시 파일만 지운다. 문서와 IndexedDB 복구본은 건드리지 않는다. */
    fun close() {
        transfers.values.forEach { it.file.delete() }
        documents.values.forEach { it.snapshot?.delete() }
        transfers.clear(); documents.clear()
    }
}

/** 웹 UI에 노출해도 되는 짧은 오류만 경계 밖으로 보낸다. 파일 경로와 내부 예외는 숨긴다. */
class BridgeFailure(val code: String, message: String) : Exception(message)
