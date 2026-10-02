//! 저장된 문서에서 자간/장평/스타일 변경이 가짜 쪽 나눔을 만들지 않는지 검사한다.
//! 새 문서는 저장 좌표가 없어 이 결함을 놓치므로 원본의 공개 예제 문서를 사용한다.
#![cfg(not(target_arch = "wasm32"))]

use rhwp::wasm_api::HwpDocument;

fn sample(name: &str) -> HwpDocument {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("rhwp-studio/public/samples")
        .join(name);
    let bytes = std::fs::read(path).expect("공개 예제 문서 읽기");
    HwpDocument::from_bytes(&bytes).expect("예제 문서 파싱")
}

/// 서식만 바꿨을 때 문단 내용과 개수가 달라지지 않았는지도 함께 비교한다.
fn text(doc: &HwpDocument) -> Vec<String> {
    doc.document().sections[0]
        .paragraphs
        .iter()
        .map(|para| para.text.clone())
        .collect()
}

#[test]
fn spacing_and_width_preserve_stored_page_flow_and_undo() {
    for (name, paragraph) in [
        ("number-bullet.hwp", 2),
        ("para-head-num-2.hwp", 5),
        ("biz_plan.hwp", 14),
    ] {
        for props in [
            r#"{"spacings":[-1,-1,-1,-1,-1,-1,-1]}"#,
            r#"{"spacings":[1,1,1,1,1,1,1]}"#,
            r#"{"ratios":[99,99,99,99,99,99,99]}"#,
            r#"{"ratios":[101,101,101,101,101,101,101]}"#,
        ] {
            let mut doc = sample(name);
            let pages = doc.page_count();
            let original_text = text(&doc);
            let para = &doc.document().sections[0].paragraphs[paragraph];
            let len = para.text.chars().count();
            let shape = para.char_shape_id_at(0).expect("원래 글자 모양");
            doc.apply_char_format_native(0, paragraph, 0, len, props)
                .expect("서식 적용");
            assert_eq!(doc.page_count(), pages, "{name}: {props}");
            assert_eq!(text(&doc), original_text, "서식 변경은 본문을 보존한다");

            // 실제 저장 파일에도 잘못된 페이지 좌표가 남지 않아야 한다.
            let saved = doc.export_hwp().expect("HWP 저장");
            let reopened = HwpDocument::from_bytes(&saved).expect("저장 파일 다시 열기");
            assert_eq!(reopened.page_count(), pages, "{name}: 저장 후 쪽 수");
            assert_eq!(text(&reopened), original_text);

            doc.set_char_shape_id_native(0, paragraph, 0, len, shape)
                .expect("실행 취소의 원래 서식 복원");
            assert_eq!(doc.page_count(), pages, "{name}: 실행 취소 후 쪽 수");
        }
    }
}

#[test]
fn paragraph_style_and_spacing_keep_following_paragraphs_on_page() {
    let mut doc = sample("number-bullet.hwp");
    let pages = doc.page_count();
    let original_text = text(&doc);
    let paragraph = 2;
    let original_shape = doc.document().sections[0].paragraphs[paragraph].para_shape_id;
    let original_style = doc.document().sections[0].paragraphs[paragraph].style_id;

    doc.apply_style_native(0, paragraph, original_style as usize)
        .expect("저장된 스타일 적용");
    assert_eq!(doc.page_count(), pages, "스타일 적용 시 쪽 나눔 없음");
    doc.apply_para_format_native(0, paragraph, r#"{"lineSpacing":161}"#)
        .expect("줄 간격 변경");
    assert_eq!(doc.page_count(), pages, "작은 줄 간격 변경 시 쪽 나눔 없음");
    doc.set_para_shape_id_native(0, paragraph, original_shape)
        .expect("문단 모양 복원");
    assert_eq!(doc.page_count(), pages);
    assert_eq!(text(&doc), original_text);
}
