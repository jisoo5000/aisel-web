/* Workflow definitions only. Business records remain on the authorized server. */
(function(root,f){const a=f();if(typeof module==='object'&&module.exports)module.exports=a;else root.AiselWorkflowDomain=a;})(typeof window==='object'?window:globalThis,function(){
const config={
  "version": "1.4.1",
  "statusOptions": [
    "대기",
    "진행 중",
    "확인 필요",
    "완료",
    "보류"
  ],
  "specs": {
    "glowny": {
      "label": "글로니 Like",
      "group": "상품·제작",
      "sheet": "글로니 Like",
      "sheetId": 2026111110,
      "fields": [
        {
          "key": "title",
          "label": "자료·상품명",
          "type": "text"
        },
        {
          "key": "collection",
          "label": "자료 구분",
          "type": "select",
          "options": [
            "overview",
            "candidate",
            "market",
            "eunyeong",
            "brand",
            "performance",
            "validation"
          ]
        },
        {
          "key": "order",
          "label": "표시 순서",
          "type": "number"
        },
        {
          "key": "planningId",
          "label": "후보·자료 ID",
          "type": "text"
        },
        {
          "key": "referenceBrand",
          "label": "참고 브랜드",
          "type": "text"
        },
        {
          "key": "rankLabel",
          "label": "판매순 관찰",
          "type": "text"
        },
        {
          "key": "observedAt",
          "label": "확인 시각·기간",
          "type": "text"
        },
        {
          "key": "priceText",
          "label": "확인 가격",
          "type": "text"
        },
        {
          "key": "imageUrl",
          "label": "사진",
          "type": "url"
        },
        {
          "key": "originalImageUrl",
          "label": "원본 사진",
          "type": "url"
        },
        {
          "key": "sourceUrl",
          "label": "원상품·근거",
          "type": "url"
        },
        {
          "key": "sheetUrl",
          "label": "구글 시트",
          "type": "url"
        },
        {
          "key": "slidesUrl",
          "label": "구글 프레젠테이션",
          "type": "url"
        },
        {
          "key": "reference",
          "label": "관찰한 특징·기존 자산",
          "type": "textarea"
        },
        {
          "key": "mechanism",
          "label": "작동 원리·살 이유",
          "type": "textarea"
        },
        {
          "key": "application",
          "label": "에이슬 적용안",
          "type": "textarea"
        },
        {
          "key": "counterEvidence",
          "label": "반대 근거·반품 위험",
          "type": "textarea"
        },
        {
          "key": "evidence",
          "label": "판매·반품·출처 근거",
          "type": "textarea"
        },
        {
          "key": "relatedProduct",
          "label": "기존 상품·코디 연결",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "확인된 자사 품번",
          "type": "text"
        },
        {
          "key": "nextAction",
          "label": "다음 검증",
          "type": "textarea"
        },
        {
          "key": "decision",
          "label": "검토 판단",
          "type": "select",
          "options": [
            "시장 관찰",
            "검토 제안",
            "기존 결정",
            "보류",
            "수정 검토",
            "검토 완료"
          ]
        },
        {
          "key": "reviewNote",
          "label": "검토 메모",
          "type": "textarea"
        },
        {
          "key": "assigneeName",
          "label": "검토 담당",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "다음 확인일",
          "type": "date"
        }
      ],
      "workflow": [
        "판매순·자사 성과 확인",
        "사진·기존 상품 비교",
        "에이슬 적용안 검토",
        "샘플·착용 검증",
        "판매·반품 결과 확인"
      ],
      "note": "시장 관찰과 개발 제안을 구분합니다. 검토 상태는 생산 승인이나 기존 작업지시서의 진행 상태를 바꾸지 않습니다.",
      "source": null
    },
    "meeting": {
      "label": "디자인회의 준비·정리",
      "group": "상품·제작",
      "sheet": "디자인회의 준비·정리",
      "sheetId": 2026111100,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "meetingDate",
          "label": "회의일",
          "type": "date"
        },
        {
          "key": "reference",
          "label": "성공 사례·원리",
          "type": "textarea"
        },
        {
          "key": "hypothesis",
          "label": "에이슬 적용안·살 이유",
          "type": "textarea"
        },
        {
          "key": "counterEvidence",
          "label": "반대 근거·검증",
          "type": "textarea"
        },
        {
          "key": "decision",
          "label": "회의 결정",
          "type": "select",
          "options": [
            "검토 전",
            "진행",
            "수정",
            "보류",
            "드롭"
          ]
        },
        {
          "key": "minutes",
          "label": "사람의 회의 원문",
          "type": "textarea"
        },
        {
          "key": "slidesUrl",
          "label": "회의 프레젠테이션",
          "type": "url"
        }
      ],
      "workflow": [
        "기존 자산·판매·반품 확인",
        "후보·사진·원가·수요 준비",
        "회의자료 연결",
        "사람의 결정·원문 기록",
        "담당·기한·수정 작지 연결",
        "다음 회의에서 결과 확인"
      ],
      "note": "원문과 AI 의견을 구분합니다. 기획ID와 품번으로 연결하고 모든 후보를 보존합니다.",
      "source": "meeting"
    },
    "naming": {
      "label": "품명 확정·발주 준비",
      "group": "상품·제작",
      "sheet": "품명 확정·발주 준비",
      "sheetId": 2026111101,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "temporaryName",
          "label": "현재 가제",
          "type": "text"
        },
        {
          "key": "finalName",
          "label": "현재 최종명",
          "type": "text"
        },
        {
          "key": "nameState",
          "label": "원본 이름 상태",
          "type": "select",
          "options": [
            "미확인",
            "미확정",
            "최종 확정",
            "변경 요청"
          ]
        },
        {
          "key": "confirmedAt",
          "label": "원본 확정일",
          "type": "date"
        },
        {
          "key": "revision",
          "label": "원본 이름 버전",
          "type": "text"
        },
        {
          "key": "sampleEvidence",
          "label": "최종 샘플 확인 근거",
          "type": "textarea"
        }
      ],
      "workflow": [
        "회의 후 가제 검토",
        "사진·사양·품번 대조",
        "기존 작지에서 대표 최종 확정",
        "새 최초 발주 조건 확인",
        "변경 이력 보존"
      ],
      "note": "최종명 확정은 기존 작업지시서에서 합니다. 이 기록의 상태 변경은 원본 이름을 확정하거나 발주하지 않습니다.",
      "source": null
    },
    "purchase": {
      "label": "발주 요청·진행",
      "group": "상품·제작",
      "sheet": "발주 요청·진행",
      "sheetId": 2026111102,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "orderId",
          "label": "기존 발주 ID",
          "type": "text"
        },
        {
          "key": "orderType",
          "label": "종류",
          "type": "select",
          "options": [
            "초도",
            "리오더"
          ]
        },
        {
          "key": "options",
          "label": "색상·사이즈·수량",
          "type": "textarea"
        },
        {
          "key": "quantity",
          "label": "발주 수량",
          "type": "number"
        },
        {
          "key": "unitCost",
          "label": "확인 원가",
          "type": "number"
        },
        {
          "key": "supplier",
          "label": "공장·거래처",
          "type": "text"
        },
        {
          "key": "requestedDate",
          "label": "요청일",
          "type": "date"
        },
        {
          "key": "deliveryDate",
          "label": "납기",
          "type": "date"
        },
        {
          "key": "receivedQuantity",
          "label": "실입고 수량",
          "type": "number"
        },
        {
          "key": "orderState",
          "label": "발주 상태",
          "type": "select",
          "options": [
            "요청",
            "검토",
            "승인 대기",
            "기존 발주 확정",
            "생산 중",
            "입고 일부",
            "입고 완료",
            "보류"
          ]
        },
        {
          "key": "decisionBasis",
          "label": "수량·재고·현금 판단 근거",
          "type": "textarea"
        }
      ],
      "workflow": [
        "요청·품번·옵션 정리",
        "최종명·사양·원가 확인",
        "수량·재고·납기·현금 검토",
        "기존 발주 원본에서 확정",
        "생산·입고·불량 대조",
        "판매 후 다음 발주 검토"
      ],
      "note": "요청 기록과 실제 공장 발주를 구분합니다. 초도·리오더, 부분 입고와 완료를 별도로 기록합니다.",
      "source": null
    },
    "contentPlan": {
      "label": "콘텐츠 기획·제작",
      "group": "상품·제작",
      "sheet": "콘텐츠 기획·제작",
      "sheetId": 2026111103,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "assetId",
          "label": "소재·콘텐츠 ID",
          "type": "text"
        },
        {
          "key": "benchmark",
          "label": "성공 사례·작동 원리",
          "type": "textarea"
        },
        {
          "key": "hook",
          "label": "첫 후킹·고객 욕구",
          "type": "textarea"
        },
        {
          "key": "shotList",
          "label": "장면 순서·제품 증명·CTA",
          "type": "textarea"
        },
        {
          "key": "slidesUrl",
          "label": "Google 프레젠테이션",
          "type": "url"
        },
        {
          "key": "publishedUrl",
          "label": "게시 결과",
          "type": "url"
        },
        {
          "key": "campaignId",
          "label": "광고·캠페인 ID",
          "type": "text"
        },
        {
          "key": "testHypothesis",
          "label": "실험 가설·비교 조건",
          "type": "textarea"
        }
      ],
      "workflow": [
        "성공한 구성 찾기",
        "제품 사실·고객에 맞게 재구성",
        "컷·대본·코디·슬라이드 연결",
        "촬영·제작·검수",
        "게시·광고 ID 연결",
        "기간별 결과·다음 실험"
      ],
      "note": "컨셉보드 원본을 유지하고 콘텐츠ID → 광고ID → 성과 기록을 연결합니다.",
      "source": "content"
    },
    "styling": {
      "label": "코디 내역·반응",
      "group": "상품·제작",
      "sheet": "코디 내역·반응",
      "sheetId": 2026111104,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "stylingId",
          "label": "코디 ID",
          "type": "text"
        },
        {
          "key": "items",
          "label": "함께 입은 품번·옵션",
          "type": "textarea"
        },
        {
          "key": "shootDate",
          "label": "촬영일",
          "type": "date"
        },
        {
          "key": "intent",
          "label": "코디 의도·고객·상황",
          "type": "textarea"
        },
        {
          "key": "assetId",
          "label": "사진·영상 ID",
          "type": "text"
        },
        {
          "key": "slidesUrl",
          "label": "코디 프레젠테이션",
          "type": "url"
        },
        {
          "key": "reactionId",
          "label": "반응·성과 기록 ID",
          "type": "text"
        },
        {
          "key": "feedback",
          "label": "효과 확인·보완할 점",
          "type": "textarea"
        }
      ],
      "workflow": [
        "상품·착장 목적 정리",
        "기존 성공 코디 참고",
        "코디·촬영·자산 연결",
        "게시·광고 소재 연결",
        "고객 반응 확인",
        "유지할 점·다음 수정 기록"
      ],
      "note": "연경님을 포함한 실제 담당자를 기록합니다. 광고 노출·상품·시기 차이를 코디 담당자 능력으로 단정하지 않습니다.",
      "source": null
    },
    "reaction": {
      "label": "상품 반응·리오더 판단",
      "group": "판매",
      "sheet": "상품 반응·리오더 판단",
      "sheetId": 2026111105,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "productNo",
          "label": "판매 상품번호",
          "type": "text"
        },
        {
          "key": "optionId",
          "label": "옵션 ID",
          "type": "text"
        },
        {
          "key": "designer",
          "label": "디자이너",
          "type": "text"
        },
        {
          "key": "periodStart",
          "label": "판매 시작",
          "type": "date"
        },
        {
          "key": "periodEnd",
          "label": "판매 종료",
          "type": "date"
        },
        {
          "key": "returnEnd",
          "label": "반품 관찰 종료",
          "type": "date"
        },
        {
          "key": "soldUnits",
          "label": "취소 제외 판매 수량",
          "type": "number"
        },
        {
          "key": "availableUnits",
          "label": "기간 판매가능 수량",
          "type": "number"
        },
        {
          "key": "deliveredUnits",
          "label": "같은 판매집단 배송완료 수량",
          "type": "number"
        },
        {
          "key": "returnedUnits",
          "label": "같은 판매집단 반품완료 수량",
          "type": "number"
        },
        {
          "key": "cohort",
          "label": "판매·배송 집단 ID",
          "type": "text"
        },
        {
          "key": "returnCohort",
          "label": "반품 집단 ID",
          "type": "text"
        },
        {
          "key": "sampleState",
          "label": "표본 상태",
          "type": "select",
          "options": [
            "미연결",
            "관찰 중",
            "비교 가능"
          ]
        },
        {
          "key": "definition",
          "label": "기간·분모·취소·교환 처리",
          "type": "textarea"
        },
        {
          "key": "inventory",
          "label": "현재고·입고예정·납기",
          "type": "textarea"
        },
        {
          "key": "profit",
          "label": "확인된 이익·미확인 비용",
          "type": "textarea"
        },
        {
          "key": "outcome",
          "label": "다음 판단",
          "type": "select",
          "options": [
            "관찰",
            "개선",
            "리오더 검토",
            "리오더 결정",
            "드롭 검토",
            "드롭 결정",
            "보류"
          ]
        },
        {
          "key": "rationale",
          "label": "결정 근거·반대 근거",
          "type": "textarea"
        }
      ],
      "workflow": [
        "품번·옵션·담당 연결",
        "동일 기간 판매·반품 확인",
        "표본·재고·납기·이익 점검",
        "관찰·개선·리오더·드롭 검토",
        "사람의 결정·기한 기록",
        "발주 또는 다음 실험 연결"
      ],
      "note": "판매율=판매수량÷판매가능수량. 반품률은 같은 집단의 배송완료 대비 반품완료이며 관찰 중에는 잠정값입니다. 자료 없음은 0이 아닙니다.",
      "source": "sales"
    },
    "campaign": {
      "label": "광고·마케팅 성과",
      "group": "판매",
      "sheet": "광고·마케팅 성과",
      "sheetId": 2026111106,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "campaignId",
          "label": "캠페인 ID",
          "type": "text"
        },
        {
          "key": "adId",
          "label": "광고 ID",
          "type": "text"
        },
        {
          "key": "assetId",
          "label": "소재 ID",
          "type": "text"
        },
        {
          "key": "channel",
          "label": "매체",
          "type": "text"
        },
        {
          "key": "periodStart",
          "label": "집계 시작",
          "type": "date"
        },
        {
          "key": "periodEnd",
          "label": "집계 종료",
          "type": "date"
        },
        {
          "key": "currency",
          "label": "통화",
          "type": "select",
          "options": [
            "KRW",
            "USD"
          ]
        },
        {
          "key": "spend",
          "label": "광고비",
          "type": "number"
        },
        {
          "key": "impressions",
          "label": "노출",
          "type": "number"
        },
        {
          "key": "clicks",
          "label": "클릭",
          "type": "number"
        },
        {
          "key": "purchases",
          "label": "귀속 구매",
          "type": "number"
        },
        {
          "key": "attributedRevenue",
          "label": "귀속 매출",
          "type": "number"
        },
        {
          "key": "attribution",
          "label": "귀속 기준·창·시간대",
          "type": "text"
        },
        {
          "key": "refunds",
          "label": "확인 환불",
          "type": "number"
        },
        {
          "key": "contribution",
          "label": "확인 공헌이익",
          "type": "number"
        },
        {
          "key": "experiment",
          "label": "비교 소재·변경 변수",
          "type": "textarea"
        },
        {
          "key": "decision",
          "label": "다음 실행",
          "type": "select",
          "options": [
            "관찰",
            "유지",
            "개선 검토",
            "확대 검토",
            "중단 검토"
          ]
        }
      ],
      "workflow": [
        "제품·콘텐츠·광고 ID 연결",
        "집계기간·통화·귀속 확인",
        "광고비·구매·매출 확인",
        "반품·이익·비교 조건 검토",
        "유지·개선·확대 검토",
        "다음 실험 결과 비교"
      ],
      "note": "플랫폼별 귀속매출을 중복 합산하지 않습니다. ROAS와 회사 순익을 구분합니다.",
      "source": "finance"
    },
    "influencer": {
      "label": "인플루언서·협찬",
      "group": "판매",
      "sheet": "인플루언서·협찬",
      "sheetId": 2026111107,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "creator",
          "label": "인플루언서",
          "type": "text"
        },
        {
          "key": "channelUrl",
          "label": "채널 링크",
          "type": "url"
        },
        {
          "key": "agreement",
          "label": "협찬 조건·콘텐츠·사용범위",
          "type": "textarea"
        },
        {
          "key": "fee",
          "label": "확정 협찬비",
          "type": "number"
        },
        {
          "key": "productCost",
          "label": "제공 상품원가",
          "type": "number"
        },
        {
          "key": "shippingCost",
          "label": "배송비",
          "type": "number"
        },
        {
          "key": "shippingState",
          "label": "발송·회수 상태",
          "type": "select",
          "options": [
            "협의",
            "조건 확인",
            "발송 대기",
            "발송",
            "게시 확인",
            "회수 대기",
            "회수",
            "종료"
          ]
        },
        {
          "key": "publishDue",
          "label": "게시 기한",
          "type": "date"
        },
        {
          "key": "publishedUrl",
          "label": "실제 게시 링크",
          "type": "url"
        },
        {
          "key": "tracking",
          "label": "UTM·쿠폰·연결 ID",
          "type": "text"
        },
        {
          "key": "campaignId",
          "label": "연결 광고 ID",
          "type": "text"
        },
        {
          "key": "result",
          "label": "조회·유입·구매·매출·귀속 근거",
          "type": "textarea"
        },
        {
          "key": "feedback",
          "label": "재협찬 판단·이유",
          "type": "textarea"
        }
      ],
      "workflow": [
        "대상·고객 적합성 검토",
        "조건·비용·사용범위 확인",
        "상품·배송·기한 관리",
        "실제 게시 확인",
        "유입·구매·비용 결과 확인",
        "재협찬·개선·종료 판단"
      ],
      "note": "협의와 계약, 발송과 게시를 구분합니다. 협찬 관련 연락·결제는 별도의 실제 실행 기록으로 확인합니다.",
      "source": null
    },
    "evaluation": {
      "label": "업무 능력·성장 평가",
      "group": "관리",
      "sheet": "업무 능력·성장 평가",
      "sheetId": 2026111108,
      "fields": [
        {
          "key": "title",
          "label": "업무·상품명",
          "type": "text"
        },
        {
          "key": "productCode",
          "label": "품번",
          "type": "text"
        },
        {
          "key": "planningId",
          "label": "기획·후보 ID",
          "type": "text"
        },
        {
          "key": "assigneeName",
          "label": "담당자",
          "type": "text"
        },
        {
          "key": "dueDate",
          "label": "기한",
          "type": "date"
        },
        {
          "key": "sourceUrl",
          "label": "원본·근거 링크",
          "type": "url"
        },
        {
          "key": "evidence",
          "label": "확인한 결과·근거",
          "type": "textarea"
        },
        {
          "key": "nextAction",
          "label": "다음 행동",
          "type": "textarea"
        },
        {
          "key": "person",
          "label": "평가 대상자",
          "type": "text"
        },
        {
          "key": "role",
          "label": "담당 역할",
          "type": "text"
        },
        {
          "key": "periodStart",
          "label": "평가 시작",
          "type": "date"
        },
        {
          "key": "periodEnd",
          "label": "평가 종료",
          "type": "date"
        },
        {
          "key": "agreedGoal",
          "label": "사전에 합의한 결과·기준",
          "type": "textarea"
        },
        {
          "key": "linkedRecords",
          "label": "상품·코디·광고·업무 기록 ID",
          "type": "textarea"
        },
        {
          "key": "strength",
          "label": "효과가 확인된 점",
          "type": "textarea"
        },
        {
          "key": "gap",
          "label": "기준과의 차이·실제 사례",
          "type": "textarea"
        },
        {
          "key": "constraints",
          "label": "예산·재고·노출·협업 등 조건",
          "type": "textarea"
        },
        {
          "key": "selfReview",
          "label": "본인 의견·정정 내용",
          "type": "textarea"
        },
        {
          "key": "support",
          "label": "회사 지원·개선 행동",
          "type": "textarea"
        },
        {
          "key": "reviewDate",
          "label": "다음 확인일",
          "type": "date"
        },
        {
          "key": "reviewState",
          "label": "평가 단계",
          "type": "select",
          "options": [
            "근거 수집",
            "면담 준비",
            "본인 의견 확인",
            "개선 진행",
            "재확인 완료"
          ]
        }
      ],
      "workflow": [
        "역할·목표·평가기간 합의",
        "연결된 업무 결과 확인",
        "조건·기여·근거 검토",
        "본인 의견·정정 기회",
        "구체적인 개선·지원·기한",
        "다음 면담에서 변화 확인"
      ],
      "note": "추가 로그인한 관리 영역에서만 봅니다. 결과·행동·개선으로 평가하며 성격 단정·공개 서열·자동 인사 결정을 만들지 않습니다.",
      "source": null
    }
  }
};
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function ratio(a,b){return num(a)!==null&&num(b)!==null&&b>0?a/b:null;}
function metrics(type,v){if(type==='reaction')return {판매율:ratio(v.soldUnits,v.availableUnits),반품률:v.cohort&&v.cohort===v.returnCohort?ratio(v.returnedUnits,v.deliveredUnits):null};if(type==='campaign')return {ROAS:v.attribution?ratio(v.attributedRevenue,v.spend):null,CTR:ratio(v.clicks,v.impressions),CPC:ratio(v.spend,v.clicks),CPA:v.attribution?ratio(v.spend,v.purchases):null};return {};}
function columns(type){return ['기록ID','상태',...config.specs[type].fields.map(x=>x.label),'버전','수정일','보관'];}
function sheetRow(r){return [r.id,r.status,...config.specs[r.type].fields.map(x=>r.values[x.key]??''),r.version,new Date(r.updatedAt).toISOString(),r.archived?'예':'아니오'];}
return Object.freeze({...config,metrics,columns,sheetRow});});

