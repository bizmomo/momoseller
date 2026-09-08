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
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptSecret(encoded: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintextBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBuf);
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Coupang's signed-date uses a 2-digit year: yyMMdd'T'HHmmss'Z' (UTC).
function getSignedDate(): string {
  return new Date().toISOString().slice(2, 19).replace(/[-:]/g, "") + "Z";
}

async function callCoupangApi(
  path: string,
  query: string,
  vendorId: string,
  accessKey: string,
  secretKey: string,
) {
  const signedDate = getSignedDate();
  const message = signedDate + "GET" + path + query;
  const signature = await hmacSha256Hex(secretKey, message);
  const authorization =
    `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;

  const url = `https://api-gateway.coupang.com${path}?${query}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": authorization,
      "X-Requested-By": vendorId,
      "Content-Type": "application/json;charset=UTF-8",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("Coupang API error", res.status, text);
    throw new Error(`쿠팡 API 오류 (${res.status}): ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function todayKstDate(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await adminClient
      .from("profiles")
      .select("coupang_vendor_id, coupang_access_key_enc, coupang_secret_key_enc")
      .eq("id", user.id)
      .single();

    if (!profile?.coupang_vendor_id || !profile?.coupang_access_key_enc || !profile?.coupang_secret_key_enc) {
      return jsonResponse({ error: "쿠팡 연동이 안 되어 있어요. 마이페이지에서 먼저 연결해주세요." }, 400);
    }

    const vendorId = profile.coupang_vendor_id;
    const accessKey = await decryptSecret(profile.coupang_access_key_enc);
    const secretKey = await decryptSecret(profile.coupang_secret_key_enc);

    const date = todayKstDate();
    const path = `/v2/providers/openapi/apis/api/v5/vendors/${vendorId}/ordersheets`;
    const query = `createdAtFrom=${date}&createdAtTo=${date}&maxPerPage=50`;

    const result = await callCoupangApi(path, query, vendorId, accessKey, secretKey);
    // deno-lint-ignore no-explicit-any
    const orders: any[] = result?.data ?? [];

    let totalRevenue = 0;
    let newOrders = 0;
    let awaitingShipment = 0;

    for (const order of orders) {
      const items = order.orderItems ?? [];
      for (const item of items) {
        totalRevenue += Number(item.orderPrice) || 0;
      }
      if (order.status === "ACCEPT") newOrders++;
      if (order.status === "INSTRUCT") awaitingShipment++;
    }

    return jsonResponse({
      date,
      orderCount: orders.length,
      totalRevenue,
      newOrders,
      awaitingShipment,
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "쿠팡 데이터를 불러오지 못했어요.",
    }, 500);
  }
});
