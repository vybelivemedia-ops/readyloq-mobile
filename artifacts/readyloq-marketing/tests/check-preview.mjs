import assert from "node:assert/strict";

const domain = process.env.REPLIT_DEV_DOMAIN;
assert(domain, "REPLIT_DEV_DOMAIN is required to test the real shared preview");
const base = `https://${domain}`;
const tracking = '<script src="https://zero-to-sale.vercel.app/t.js" data-page="07a7e2abd88cbfdd96e01645" defer></script>';

const page = await fetch(`${base}/`);
assert.equal(page.status, 200, "Shared preview root must serve the existing landing page");
const html = await page.text();
assert.equal(html.split(tracking).length - 1, 1);
assert(html.indexOf(tracking) < html.indexOf("</head>"));
assert(html.includes("family=Archivo:wght@700"));
assert(html.includes("family=Source+Sans+3:wght@400"));
console.log("PASS: shared HTTPS preview, exact head script, and fonts");

for (const path of ["/src/components/pilot-signup.tsx", "/src/components/layout.tsx", "/src/pages/home.tsx"]) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, `Existing page module must load: ${path}`);
  assert((await response.text()).length > 100);
}
console.log("PASS: pilot, existing layout, and original homepage load through the shared preview");

const health = await fetch(`${base}/api-server/healthz`);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, "ok");
console.log("PASS: existing marketing API forwarding");

const invalid = await fetch(`${base}/api-server/leads`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "contact", name: "Pilot signup", email: "not-an-email", source: "readyloq-pilot" }),
});
assert.equal(invalid.status, 400); // Rejected before storage or email; no test lead.
assert.equal(invalid.headers.get("ratelimit-limit"), "15");
assert.equal((await fetch(`${base}/api-server/leads`)).status, 404);
console.log("PASS: server validation, rate limit, and no public lead listing");
