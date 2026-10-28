#!/usr/bin/env python3
"""One explicitly requested AADE lookup; no retries or raw-response persistence."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2"
SOAP = "http://www.w3.org/2003/05/soap-envelope"
SERVICE = "http://rgwspublic2/RgWsPublic2Service"
DATA = "http://rgwspublic2/RgWsPublic2"
WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
MAX_BYTES = 1_000_000
KEYS = ("AADE_USERNAME", "AADE_PASSWORD", "AADE_CALLER_AFM", "AADE_TEST_AFM")


class SafeFailure(Exception):
    """Only fixed, credential-free diagnostic messages are raised."""


def read_config(path):
    config = {}
    if path.exists():
        if path.stat().st_mode & 0o077:
            raise SafeFailure("Credential file must have owner-only permissions (chmod 600).")
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, sep, value = line.partition("=")
            key = key.strip()
            if not sep or key not in KEYS:
                raise SafeFailure("Credential file has an unsupported assignment.")
            value = value.strip()
            if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                value = value[1:-1]
            config[key] = value
    for key in KEYS:
        if key in os.environ:
            config[key] = os.environ[key]
    missing = [key for key in KEYS if not config.get(key)]
    if missing:
        raise SafeFailure("Missing configuration: " + ", ".join(missing))
    for key in ("AADE_CALLER_AFM", "AADE_TEST_AFM"):
        if not re.fullmatch(r"[0-9]{9}", config[key]):
            raise SafeFailure(key + " must be a nine-digit string.")
    return config


def make_request(config):
    envelope = ET.Element(f"{{{SOAP}}}Envelope")
    header = ET.SubElement(envelope, f"{{{SOAP}}}Header")
    security = ET.SubElement(header, f"{{{WSSE}}}Security")
    token = ET.SubElement(security, f"{{{WSSE}}}UsernameToken")
    ET.SubElement(token, f"{{{WSSE}}}Username").text = config["AADE_USERNAME"]
    ET.SubElement(token, f"{{{WSSE}}}Password").text = config["AADE_PASSWORD"]
    body = ET.SubElement(envelope, f"{{{SOAP}}}Body")
    operation = ET.SubElement(body, f"{{{SERVICE}}}rgWsPublic2AfmMethod")
    inputs = ET.SubElement(operation, f"{{{SERVICE}}}INPUT_REC")
    ET.SubElement(inputs, f"{{{DATA}}}afm_called_by").text = config["AADE_CALLER_AFM"]
    ET.SubElement(inputs, f"{{{DATA}}}afm_called_for").text = config["AADE_TEST_AFM"]
    return ET.tostring(envelope, encoding="utf-8", xml_declaration=True)


def field(parent, name):
    node = parent.find(f"{{{DATA}}}{name}") if parent is not None else None
    return (node.text or "").strip() if node is not None else ""


def parse_response(payload, config, status):
    if len(payload) > MAX_BYTES:
        raise SafeFailure("Response exceeded the size limit.")
    # Reject declarations before parsing, including non-UTF-8 byte layouts.
    if b"\x00" in payload or re.search(br"<!\s*(DOCTYPE|ENTITY)", payload, re.I):
        raise SafeFailure("Response contains a prohibited XML declaration or encoding.")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        raise SafeFailure("Service returned malformed XML.") from None
    if root.tag != f"{{{SOAP}}}Envelope":
        raise SafeFailure("Unexpected SOAP envelope.")
    bodies = root.findall(f"{{{SOAP}}}Body")
    if len(bodies) != 1:
        raise SafeFailure("Unexpected SOAP body count.")
    body = bodies[0]
    if body.find(f"{{{SOAP}}}Fault") is not None:
        return {"outcome": "soap_fault", "http_status": status}
    if status != 200:
        return {"outcome": "http_error", "http_status": status}
    response = body.find(f"{{{SERVICE}}}rgWsPublic2AfmMethodResponse")
    if response is None or len(body) != 1:
        raise SafeFailure("Unexpected SOAP operation response.")
    record = response.find(f"{{{SERVICE}}}result/{{{DATA}}}rg_ws_public2_result_rtType")
    if record is None:
        raise SafeFailure("Missing business-result record.")
    error = record.find(f"{{{DATA}}}error_rec")
    code = field(error, "error_code")
    if code or field(error, "error_descr"):
        # Service text may contain identifiers; never print or persist it.
        return {"outcome": "application_error", "http_status": status,
                "error_code": code if re.fullmatch(r"[A-Z0-9_:-]{1,80}", code) else "unrecognized"}
    basic = record.find(f"{{{DATA}}}basic_rec")
    afm = field(basic, "afm")
    if not afm:
        return {"outcome": "incomplete_result", "http_status": status}
    if afm != config["AADE_TEST_AFM"]:
        return {"outcome": "identity_mismatch", "http_status": status}
    if not field(basic, "onomasia") or field(basic, "deactivation_flag") not in ("1", "2") or not field(basic, "firm_flag_descr"):
        return {"outcome": "incomplete_result", "http_status": status}
    caller = record.find(f"{{{DATA}}}afm_called_by_rec")
    caller_matches = field(caller, "afm_called_by") == config["AADE_CALLER_AFM"]
    activities = record.findall(f"{{{DATA}}}firm_act_tab/{{{DATA}}}item")
    return {
        "outcome": "matched" if caller_matches else "caller_context_mismatch",
        "http_status": status,
        "identity_matches": True,
        "charged_principal_matches": caller_matches,
        "legal_name": field(basic, "onomasia"),
        "afm_status": field(basic, "deactivation_flag_descr"),
        "business_activity_status": field(basic, "firm_flag_descr"),
        "activity_count": len(activities),
        "normal_vat_regime": field(basic, "normal_vat_system_flag"),
        "publication_approved": False,
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SafeFailure("Service redirected; credentials were not forwarded.")


def lookup(config):
    request = urllib.request.Request(
        ENDPOINT, data=make_request(config),
        headers={"Content-Type": "application/soap+xml; charset=utf-8"}, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            status, payload = response.status, response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read(MAX_BYTES + 1)
        error.close()
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SafeFailure("Network/TLS failure; no automatic retry was made.") from None
    summary = parse_response(payload, config, status)
    summary.update({"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "method": "authorized_api", "response_sha256": hashlib.sha256(payload).hexdigest(),
                    "attempts": 1, "raw_response_saved": False})
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lookup", action="store_true", help="Send one lookup for the explicitly authorized configured AFM.")
    args = parser.parse_args()
    try:
        config = read_config(ROOT / ".env.aade.local")
        if not args.lookup:
            print("Configuration complete; no network request made. Use --lookup for the authorized test.")
            return 0
        summary = lookup(config)
        destination = ROOT / ".data" / "aade"
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = destination / ("smoke-" + uuid.uuid4().hex + ".json")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(summary, output, ensure_ascii=False, indent=2)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        print("Minimal result saved privately under .data/aade/; raw response discarded.")
        return 0 if summary["outcome"] == "matched" else 1
    except SafeFailure as error:
        print(str(error))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
