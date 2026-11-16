// Minimal ILIAS SOAP (rpc/encoded) client for the local lab only.
const ENDPOINT = process.env.ILIAS_LAB_URL ?? "http://localhost:8080/soap/server.php";
if (!/^http:\/\/localhost(:\d+)?\//.test(ENDPOINT)) throw new Error("The lab seed only talks to a localhost ILIAS.");

const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function soap(method, params) {
  const args = Object.entries(params).map(([k, v]) => v === null ? `<${k} xsi:nil="true"/>` : `<${k} xsi:type="${typeof v === "number" ? "xsd:int" : "xsd:string"}">${esc(v)}</${k}>`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns1="urn:ilUserAdministration"><SOAP-ENV:Body><ns1:${method}>${args}</ns1:${method}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `urn:ilUserAdministration#${method}` }, body });
  const text = await response.text();
  const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/);
  if (fault) throw new Error(`${method}: ${fault[1]}`);
  const inner = text.match(/<SOAP-ENV:Body>[\s\S]*?<ns1:\w+Response[^>]*>([\s\S]*?)<\/ns1:\w+Response>/)?.[1] ?? "";
  const value = inner.match(/>([\s\S]*?)<\//)?.[1] ?? "";
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
