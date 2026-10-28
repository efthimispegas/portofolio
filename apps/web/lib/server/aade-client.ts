/** Private AADE transport/normalizer. Import aade.ts from application server code. */
import { createHash } from 'node:crypto';
import sax from 'sax';

export const AADE_ENDPOINT = 'https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2';
export const AADE_MAX_BYTES = 1_000_000;
const SOAP = 'http://www.w3.org/2003/05/soap-envelope';
const SERVICE = 'http://rgwspublic2/RgWsPublic2Service';
const DATA = 'http://rgwspublic2/RgWsPublic2';
const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
export type AadeConfiguration = { username: string; password: string; callerAfm: string };
type Failure = 'configuration_error' | 'invalid_request' | 'timeout' | 'network_error' |
  'http_error' | 'rate_limited' | 'redirect_rejected' | 'response_too_large' | 'soap_fault' |
  'application_error' | 'malformed_response' | 'incomplete_result' | 'identity_mismatch' | 'caller_context_mismatch';
export type AadeActivity = { code: string; description: string; kind: string; kindDescription: string };
export type AadeParsedResult = { outcome: Failure; httpStatus?: number; credentialRejected?: boolean } | {
  outcome: 'matched'; httpStatus: number;
  evidence: {
    legalName: string; afmStatusCode: '1' | '2'; afmStatusLabel: string;
    businessActivityStatus: string; normalVatRegime: string | null;
    activities: AadeActivity[]; callReference: string | null;
  };
};
export type AadeResult = AadeParsedResult & {
  source: 'aade'; method: 'authorized_api'; observedAt: string;
  attempts: 0 | 1; responseSha256?: string; publicationApproved: false;
};
type Xml = { uri: string; local: string; text: string; children: Xml[] };
class InvalidXml extends Error {}
const invalid = (): never => { throw new InvalidXml(); };
const children = (x: Xml, uri: string, local: string) => x.children.filter(n => n.uri === uri && n.local === local);
function one(x: Xml, uri: string, local: string, required = true): Xml | undefined {
  const hits = children(x, uri, local);
  if (hits.length > 1 || (required && hits.length !== 1)) invalid();
  return hits[0];
}
function field(x: Xml, local: string): string {
  const n = one(x, DATA, local, false);
  if (!n) return '';
  if (n.children.length || n.text.length > 4000) invalid();
  return n.text.trim();
}
function parseXml(bytes: Uint8Array): Xml {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return invalid(); }
  if (text.includes('\0') || /<!\s*(DOCTYPE|ENTITY)/i.test(text)) invalid();
  const declaredEncoding = text.match(/<\?xml[^?]*encoding\s*=\s*["']([^"']+)/i)?.[1];
  if (declaredEncoding && !/^utf-8$/i.test(declaredEncoding)) invalid();
  // sax supports strictEntities; its separately published types omit the option.
  const parserOptions: sax.SAXOptions & { strictEntities: boolean } = { xmlns: true, strictEntities: true };
  const parser = sax.parser(true, parserOptions);
  const stack: Xml[] = []; let root: Xml | undefined; let count = 0;
  parser.onerror = invalid; parser.ondoctype = invalid;
  parser.onopentag = raw => {
    const tag = raw as sax.QualifiedTag;
    if (++count > 20_000 || stack.length >= 32) invalid();
    const node: Xml = { uri: tag.uri, local: tag.local, text: '', children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else { if (root) invalid(); root = node; }
    stack.push(node);
  };
  const append = (value: string) => {
    if (!stack.length) { if (value.trim()) invalid(); return; }
    const node = stack[stack.length - 1]; node.text += value;
    if (node.text.length > 16_000) invalid();
  };
  parser.ontext = append; parser.oncdata = append;
  parser.onclosetag = () => { stack.pop(); };
  parser.write(text).close();
  if (!root || stack.length) return invalid();
  return root;
}

/** Failures deliberately omit provider text and private identifiers. No raw XML escapes. */
export function parseAadeResponse(bytes: Uint8Array, targetAfm: string, callerAfm: string, status: number): AadeParsedResult {
  if (bytes.byteLength > AADE_MAX_BYTES) return { outcome: 'response_too_large', httpStatus: status };
  if (status >= 300 && status < 400) return { outcome: 'redirect_rejected', httpStatus: status };
  if (status === 429) return { outcome: 'rate_limited', httpStatus: status };
  try {
    const root = parseXml(bytes);
    if (root.uri !== SOAP || root.local !== 'Envelope') invalid();
    const body = one(root, SOAP, 'Body')!;
    if (body.children.length !== 1) invalid();
    if (one(body, SOAP, 'Fault', false)) return { outcome: 'soap_fault', httpStatus: status };
    if (status !== 200) return { outcome: 'http_error', httpStatus: status };
    const response = one(body, SERVICE, 'rgWsPublic2AfmMethodResponse')!;
    const result = one(response, SERVICE, 'result')!;
    const record = one(result, DATA, 'rg_ws_public2_result_rtType')!;
    const error = one(record, DATA, 'error_rec')!;
    const code = field(error, 'error_code');
    if (code || field(error, 'error_descr')) return {
      outcome: 'application_error', httpStatus: status,
      credentialRejected: code === 'RG_WS_PUBLIC_TOKEN_USERNAME_NOT_AUTHENTICATED',
    };
    const basic = one(record, DATA, 'basic_rec')!;
    const afm = field(basic, 'afm');
    if (!afm) return { outcome: 'incomplete_result', httpStatus: status };
    if (afm !== targetAfm) return { outcome: 'identity_mismatch', httpStatus: status };
    const caller = one(record, DATA, 'afm_called_by_rec')!;
    if (field(caller, 'afm_called_by') !== callerAfm) return { outcome: 'caller_context_mismatch', httpStatus: status };
    const legalName = field(basic, 'onomasia');
    const afmStatusCode = field(basic, 'deactivation_flag');
    const businessActivityStatus = field(basic, 'firm_flag_descr');
    if (!legalName || !businessActivityStatus || !['1', '2'].includes(afmStatusCode))
      return { outcome: 'incomplete_result', httpStatus: status };
    const table = one(record, DATA, 'firm_act_tab')!;
    if (table.children.some(n => n.uri !== DATA || n.local !== 'item') || table.children.length > 1000) invalid();
    const activities = table.children.map(item => ({
      code: field(item, 'firm_act_code'), description: field(item, 'firm_act_descr'),
      kind: field(item, 'firm_act_kind'), kindDescription: field(item, 'firm_act_kind_descr'),
    }));
    return { outcome: 'matched', httpStatus: status, evidence: {
      legalName, afmStatusCode: afmStatusCode as '1' | '2', afmStatusLabel: field(basic, 'deactivation_flag_descr'),
      businessActivityStatus, normalVatRegime: field(basic, 'normal_vat_system_flag') || null,
      activities, callReference: field(record, 'call_seq_id') || null,
    } };
  } catch {
    return { outcome: status !== 200 ? 'http_error' : 'malformed_response', httpStatus: status };
  }
}
const afm = (value: string) => /^[0-9]{9}$/.test(value);
const validSecret = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
function requestXml(config: AadeConfiguration, target: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP}" xmlns:w="${WSSE}" xmlns:v="${SERVICE}" xmlns:d="${DATA}"><s:Header><w:Security><w:UsernameToken><w:Username>${escapeXml(config.username)}</w:Username><w:Password>${escapeXml(config.password)}</w:Password></w:UsernameToken></w:Security></s:Header><s:Body><v:rgWsPublic2AfmMethod><v:INPUT_REC><d:afm_called_by>${config.callerAfm}</d:afm_called_by><d:afm_called_for>${target}</d:afm_called_for></v:INPUT_REC></v:rgWsPublic2AfmMethod></s:Body></s:Envelope>`;
}

/** Factory does not read files, log, persist, retry, authorize callers or publish cards. */
export function createAadeClient(config: AadeConfiguration, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const send = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) throw new Error('Invalid AADE timeout configuration.');
  // Copy primitives so mutation of the caller's config cannot retarget an in-flight request.
  const credentials = { ...config };
  return {
    async lookup(targetAfm: string): Promise<AadeResult> {
      const meta = { source: 'aade' as const, method: 'authorized_api' as const, publicationApproved: false as const };
      const finish = (result: AadeParsedResult, attempts: 0 | 1, responseSha256?: string): AadeResult => ({
        ...result, ...meta, observedAt: new Date().toISOString(), attempts, ...(responseSha256 ? { responseSha256 } : {}),
      });
      if (!validSecret(credentials.username) || !validSecret(credentials.password) || !afm(credentials.callerAfm))
        return finish({ outcome: 'configuration_error' }, 0);
      if (!afm(targetAfm)) return finish({ outcome: 'invalid_request' }, 0);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await send(AADE_ENDPOINT, {
          method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', Accept: 'application/soap+xml' },
          body: requestXml(credentials, targetAfm), redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel(); return finish({ outcome: 'redirect_rejected', httpStatus: response.status }, 1);
        }
        if (Number(response.headers.get('content-length') ?? 0) > AADE_MAX_BYTES) {
          await response.body?.cancel(); return finish({ outcome: 'response_too_large', httpStatus: response.status }, 1);
        }
        reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
        if (reader) while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > AADE_MAX_BYTES) { await reader.cancel(); return finish({ outcome: 'response_too_large', httpStatus: response.status }, 1); }
          chunks.push(part.value);
        }
        const bytes = Buffer.concat(chunks);
        return finish(parseAadeResponse(bytes, targetAfm, credentials.callerAfm, response.status), 1, createHash('sha256').update(bytes).digest('hex'));
      } catch {
        // Provider/network exception messages can contain request data; never expose them.
        return finish({ outcome: controller.signal.aborted ? 'timeout' : 'network_error' }, 1);
      } finally { clearTimeout(timer); reader?.releaseLock(); }
    },
  };
}
