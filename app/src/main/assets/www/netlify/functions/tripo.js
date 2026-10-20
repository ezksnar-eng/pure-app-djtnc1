// Netlify Function: safe proxy to the official Tripo API. Key stays in env var TRIPO_API_KEY.
const B = "https://api.tripo3d.ai/v2/openapi";
const J = { "Content-Type": "application/json" };
const out = (c, o) => ({ statusCode: c, headers: J, body: JSON.stringify(o) });
const pick = v => (v && typeof v === "object" ? v.url : v) || null;
const ALLOWED = new Set(["text_to_model", "image_to_model", "multiview_to_model", "animate_rig", "animate_retarget", "convert_model"]);

exports.handler = async (ev) => {
  const key = process.env.TRIPO_API_KEY;
  if (!key) return out(500, { error: "TRIPO_API_KEY غير مضبوط في Netlify (Environment variables)" });
  const code = process.env.ACCESS_CODE;
  if (code && (ev.headers["x-access-code"] || "") !== code) return out(401, { error: "كود الدخول خاطئ" });
  const auth = { Authorization: "Bearer " + key };
  const q = ev.queryStringParameters || {};
  try {
    if (ev.httpMethod === "POST") {
      const b = JSON.parse(ev.body || "{}");
      if (b.action === "upload") {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(b.image || "");
        if (!m) return out(400, { error: "صورة غير صالحة" });
        const type = m[1].split("/")[1].replace("jpeg", "jpg");
        const fd = new FormData();
        fd.append("file", new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), "image." + type);
        const up = await (await fetch(B + "/upload", { method: "POST", headers: auth, body: fd })).json();
        if (up.code !== 0) return out(502, { error: "رفع الصورة: " + JSON.stringify(up) });
        return out(200, { token: up.data.image_token, type });
      }
      if (b.action === "task") {
        if (!b.body || !ALLOWED.has(b.body.type)) return out(400, { error: "نوع مهمة غير مسموح" });
        const t = await (await fetch(B + "/task", { method: "POST", headers: { ...auth, ...J }, body: JSON.stringify(b.body) })).json();
        if (t.code !== 0) return out(502, { error: "Tripo: " + (t.message || "") + " " + (t.suggestion || "") + " [" + t.code + "]" });
        return out(200, { id: t.data.task_id });
      }
      return out(400, { error: "طلب غير معروف" });
    }
    if (q.balance) {
      const r = await (await fetch(B + "/user/balance", { headers: auth })).json();
      return out(200, { balance: r.data && r.data.balance });
    }
    if (q.id) {
      const r = await (await fetch(B + "/task/" + encodeURIComponent(q.id), { headers: auth })).json();
      if (r.code !== 0) return out(502, { error: "Tripo: " + (r.message || JSON.stringify(r)) });
      const o = r.data.output || {};
      return out(200, { status: r.data.status, progress: r.data.progress, url: pick(o.pbr_model) || pick(o.model) || pick(o.base_model), preview: pick(o.rendered_image) });
    }
    if (q.dl) { // fallback download proxy (Netlify limit ~6MB)
      const u = new URL(q.dl);
      if (u.protocol !== "https:" || !/tripo3d/.test(u.hostname)) return out(400, { error: "رابط غير مسموح" });
      const f = await fetch(u);
      return { statusCode: 200, headers: { "Content-Type": "model/gltf-binary" }, isBase64Encoded: true, body: Buffer.from(await f.arrayBuffer()).toString("base64") };
    }
    return out(400, { error: "طلب غير معروف" });
  } catch (e) { return out(500, { error: String(e.message || e) }); }
};
