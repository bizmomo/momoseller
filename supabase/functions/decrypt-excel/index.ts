import { createClient } from "npm:@supabase/supabase-js@2";
import * as officeCrypto from "npm:officecrypto-tool@0.0.19";
import { Buffer } from "node:buffer";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    // Verify the caller is logged in. We don't scope any data to the user
    // here (nothing is stored), this just keeps the endpoint from being an
    // open decryption oracle for anyone who finds the URL.
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "로그인이 필요해요." }, 401);
    }

    const { fileBase64, password } = await req.json();
    if (!fileBase64 || typeof fileBase64 !== "string") {
      return jsonResponse({ error: "파일 데이터가 없어요." }, 400);
    }
    if (!password || typeof password !== "string") {
      return jsonResponse({ error: "비밀번호를 입력해주세요." }, 400);
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");

    let decrypted: Buffer;
    try {
      decrypted = await officeCrypto.decrypt(fileBuffer, { password });
    } catch (err) {
      // officecrypto-tool throws "The password is incorrect" for a wrong
      // password; anything else (malformed file, unsupported encryption)
      // is reported generically so we never leak internal error detail.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("password")) {
        return jsonResponse({ error: "비밀번호가 올바르지 않습니다." }, 401);
      }
      console.error(err);
      return jsonResponse({ error: "파일을 여는 데 실패했어요." }, 500);
    }
    // `password` and `fileBuffer`/`decrypted` only ever exist in memory for
    // this one request - nothing is written to disk or to any database, and
    // nothing is logged above beyond a generic non-password decrypt failure.

    return jsonResponse({ decryptedBase64: Buffer.from(decrypted).toString("base64") });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "처리 중 오류가 발생했어요." }, 500);
  }
});
