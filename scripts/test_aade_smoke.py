"""Offline safety/contract checks; synthetic identities and no network calls."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("aade_smoke", Path(__file__).with_name("aade-smoke.py"))
aade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aade)

CONFIG = {"AADE_USERNAME": "synthetic-user", "AADE_PASSWORD": 'synthetic<&"password',
          "AADE_CALLER_AFM": "000000001", "AADE_TEST_AFM": "000000002"}


def response(afm="000000002", caller="000000001", error=None):
    root = ET.Element(f"{{{aade.SOAP}}}Envelope")
    body = ET.SubElement(root, f"{{{aade.SOAP}}}Body")
    reply = ET.SubElement(body, f"{{{aade.SERVICE}}}rgWsPublic2AfmMethodResponse")
    result = ET.SubElement(reply, f"{{{aade.SERVICE}}}result")
    record = ET.SubElement(result, f"{{{aade.DATA}}}rg_ws_public2_result_rtType")
    basic = ET.SubElement(record, f"{{{aade.DATA}}}basic_rec")
    for key, value in {"afm": afm, "onomasia": "Synthetic Business", "deactivation_flag": "1",
                       "firm_flag_descr": "ΕΠΙΤΗΔΕΥΜΑΤΙΑΣ"}.items():
        ET.SubElement(basic, f"{{{aade.DATA}}}{key}").text = value
    caller_record = ET.SubElement(record, f"{{{aade.DATA}}}afm_called_by_rec")
    ET.SubElement(caller_record, f"{{{aade.DATA}}}afm_called_by").text = caller
    if error:
        errors = ET.SubElement(record, f"{{{aade.DATA}}}error_rec")
        ET.SubElement(errors, f"{{{aade.DATA}}}error_code").text = error
        ET.SubElement(errors, f"{{{aade.DATA}}}error_descr").text = "Sensitive server text must not escape"
    return ET.tostring(root)


class SmokeChecks(unittest.TestCase):
    def test_request_escapes_secrets_and_preserves_identifiers(self):
        xml = aade.make_request(CONFIG)
        root = ET.fromstring(xml)
        self.assertEqual(root.find(f".//{{{aade.WSSE}}}Password").text, CONFIG["AADE_PASSWORD"])
        self.assertEqual(root.find(f".//{{{aade.DATA}}}afm_called_for").text, "000000002")
        self.assertNotIn(b"synthetic<&", xml)

    def test_matched_summary_omits_private_identifiers(self):
        result = aade.parse_response(response(), CONFIG, 200)
        self.assertEqual(result["outcome"], "matched")
        self.assertFalse(result["publication_approved"])
        self.assertNotIn(CONFIG["AADE_TEST_AFM"], str(result))
        self.assertNotIn(CONFIG["AADE_PASSWORD"], str(result))

    def test_identifier_mismatch_fails(self):
        result = aade.parse_response(response(afm="000000003"), CONFIG, 200)
        self.assertEqual(result["outcome"], "identity_mismatch")

    def test_charged_principal_mismatch_fails(self):
        result = aade.parse_response(response(caller="000000003"), CONFIG, 200)
        self.assertEqual(result["outcome"], "caller_context_mismatch")

    def test_application_error_does_not_become_success_or_leak_text(self):
        result = aade.parse_response(response(error="RG_WS_PUBLIC_TEST"), CONFIG, 200)
        self.assertEqual(result["outcome"], "application_error")
        self.assertNotIn("Sensitive server text", str(result))

    def test_missing_identity_is_incomplete(self):
        result = aade.parse_response(response(afm=""), CONFIG, 200)
        self.assertEqual(result["outcome"], "incomplete_result")

    def test_soap_fault_is_reported_without_server_text(self):
        payload = f'<Envelope xmlns="{aade.SOAP}"><Body><Fault><Reason>private</Reason></Fault></Body></Envelope>'.encode()
        self.assertEqual(aade.parse_response(payload, CONFIG, 500), {"outcome": "soap_fault", "http_status": 500})

    def test_prohibits_entities_malformed_xml_and_wrong_envelope(self):
        for payload in (b'<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>', b'<broken', b'<Envelope/>'):
            with self.assertRaises(aade.SafeFailure):
                aade.parse_response(payload, CONFIG, 200)

    def test_size_limit(self):
        with self.assertRaises(aade.SafeFailure):
            aade.parse_response(b"x" * (aade.MAX_BYTES + 1), CONFIG, 200)

    def test_redirect_does_not_forward_credentials(self):
        with self.assertRaises(aade.SafeFailure):
            aade.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_config_missing_and_permissions_fail_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env.aade.local"
            path.write_text("AADE_USERNAME=\nAADE_PASSWORD=\n")
            path.chmod(0o600)
            with self.assertRaises(aade.SafeFailure):
                aade.read_config(path)
            path.chmod(0o644)
            with self.assertRaises(aade.SafeFailure):
                aade.read_config(path)


if __name__ == "__main__":
    unittest.main()
