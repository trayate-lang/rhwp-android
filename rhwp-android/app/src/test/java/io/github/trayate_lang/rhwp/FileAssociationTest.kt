package io.github.trayate_lang.rhwp

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** 실제 Manifest를 읽어 연결 앱 후보를 확인한다. 파일 내용 파싱과는 별도 경계다. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30, 34])
class FileAssociationTest {
    /** 파일 공급자가 전달한 URI/형식으로 우리 편집기가 기본 연결 후보가 되는지 판정한다. */
    private fun accepts(uri: String, mime: String?, action: String = Intent.ACTION_VIEW): Boolean {
        val context = RuntimeEnvironment.getApplication()
        val intent = Intent(action).setDataAndType(Uri.parse(uri), mime)
        return context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .any { it.activityInfo.name == MainActivity::class.java.name }
    }

    @Test fun typedDocumentsCanUseOpaqueContentUris() {
        for (mime in listOf("application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp",
            "application/hwp", "application/hwp+zip", "application/vnd.hancom.hwpx",
            "application/x-hwpx", "application/haansofthwpx")) {
            assertTrue(mime, accepts("content://documents/document/42", mime))
            assertTrue("공유 $mime", accepts("content://documents/document/42", mime, Intent.ACTION_SEND))
        }
    }

    @Test fun filenameFallbackAcceptsGenericTypesAndMissingType() {
        for (name in listOf("문서.hwp", "문서.HWP", "초안.수정.최종.hwpx", "문서.HWPX")) {
            for (mime in listOf("application/octet-stream", "application/zip", null)) {
                assertTrue("$name $mime", accepts("content://documents/document/$name", mime))
            }
        }
    }

    @Test fun unrelatedFilesAndWebLinksAreNotClaimed() {
        for (name in listOf("문서.pdf", "사진.jpg", "압축.zip", "문서.hwpx.zip", "문서hwp", "42")) {
            for (mime in listOf("application/octet-stream", "application/zip", "application/pdf", null)) {
                assertFalse("$name $mime", accepts("content://documents/document/$name", mime))
            }
        }
        assertFalse(accepts("https://example.com/문서.hwp", "application/x-hwp"))
    }
}
