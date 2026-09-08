import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RULES_TEXT = `[상품명 규칙]
1) 특수문자(★☆♥ 등)와 이모지를 쓰지 않는다.
2) 같은 뜻의 단어를 반복하지 않는다(예: '원피스 ... 원피스'처럼 유의어 중복 금지).
3) 특정 브랜드를 모방/암시하는 표현('OO스타일', '이미테이션' 등)을 쓰지 않는다.
4) 10대/20대/30대처럼 특정 연령대를 못박는 타겟 키워드를 쓰지 않는다.
5) '신상품', '주문폭주', '특가', '할인', '무료배송', '이벤트' 같은 홍보성 키워드를 쓰지 않는다.
6) 렌탈/해외/중고 여부는 기입하지 않는다.
7) 구성은 [브랜드명(있으면) + 소재/특징 속성 + 카테고리명 + 사이즈(해당시) + 시즌성/용도(해당시)] 순서로 간결하게, 25자 내외로 3개를 서로 다른 각도(속성 강조/카테고리 강조/용도 강조)로 만든다.

[스마트스토어 검색태그 규칙]
10개, # 기호 없이 순수 단어/구문으로, 상품명에 이미 쓴 단어·카테고리명·브랜드명과 겹치지 않는 새로운 검색 키워드(용도, 상황, 소재, 특징, 관련 검색어)로만 채운다. '할인/무료배송/특가/이벤트' 같은 홍보 문구는 쓰지 않는다.

[쿠팡 검색어 규칙]
20개, 스마트스토어 태그 10개와 최대한 겹치지 않게 다른 표현·동의어·연관 키워드까지 넓혀서 채운다(쿠팡은 검색어 허용 폭이 더 넓음). 마찬가지로 상품명과 겹치지 않게 하고, 홍보 문구는 쓰지 않는다.

[상품소개글]
3~5문장, 과장 없이 구체적인 특징 위주로, 한 문단으로 쓴다.`;

function buildPrompt(input: string, category: string, tone: string, brand: string): string {
  return `너는 네이버 스마트스토어와 쿠팡 상품 등록을 동시에 돕는 카피라이터야. 아래 상품 정보로 상품명 3개, 스마트스토어 검색태그 10개, 쿠팡 검색어 20개, 상품소개글 1개를 만들어줘.

${RULES_TEXT}

[상품 정보]
브랜드명: ${brand || "없음"}
카테고리: ${category || "미지정"}
원하는 톤: ${tone}
상품 설명: ${input}

아래 형식 그대로 보기 좋게 정리해서 답변해줘:

상품명
1)
2)
3)

스마트스토어 검색태그 (쉼표로 구분)

쿠팡 검색어 (쉼표로 구분)

상품소개글
`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "로그인이 필요해요." }, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro")
      .eq("id", user.id)
      .single();

    if (!profile?.is_pro) {
      return jsonResponse({ error: "유료 계정만 사용할 수 있는 기능이에요." }, 403);
    }

    const { input, category, tone, brand } = await req.json();
    if (!input || typeof input !== "string" || !input.trim()) {
      return jsonResponse({ error: "상품 설명을 입력해주세요." }, 400);
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const prompt = buildPrompt(input, category || "", tone || "친근하고 신뢰감 있게", brand || "");

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    return jsonResponse({ result: textBlock?.text ?? "" });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "AI 생성 중 오류가 발생했어요. 잠시 후 다시 시도해주세요." }, 500);
  }
});
