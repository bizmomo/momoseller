import { createClient } from "npm:@supabase/supabase-js@2";

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

async function getEncryptionKey(): Promise<CryptoKey> {
  const rawKey = Deno.env.get("CREDENTIALS_ENCRYPTION_KEY")!;
  const keyBytes = Uint8Array.from(atob(rawKey), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
}

// Stores iv + ciphertext together, base64-encoded, so each row only needs one column.
async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "로그인이 필요해요." }, 401);
    }

    const { clientId, clientSecret } = await req.json();
    if (!clientId || !clientSecret) {
      return jsonResponse({ error: "Client ID와 Client Secret을 모두 입력해주세요." }, 400);
    }

    // Service-role client: bypasses RLS. Only ever used here, server-side, and
    // the write is always scoped to the caller's own id (from their verified
    // JWT above) - never to an id taken from the request body.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const clientSecretEnc = await encryptSecret(String(clientSecret).trim());

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        naver_client_id: String(clientId).trim(),
        naver_client_secret_enc: clientSecretEnc,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error(updateError);
      return jsonResponse({ error: "저장 중 오류가 발생했어요." }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "저장 중 오류가 발생했어요." }, 500);
  }
});
