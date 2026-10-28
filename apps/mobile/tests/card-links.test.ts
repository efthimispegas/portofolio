import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrustedCardLink } from "../src/lib/card-links";
const origin = "https://cards.example.com";
test("accepts only canonical public card paths from the configured deployment", () => {
  assert.equal(
    parseTrustedCardLink(`${origin}/c/nikos-plumber`, origin),
    "nikos-plumber",
  );
  assert.equal(
    parseTrustedCardLink(`  ${origin}/c/nikos-plumber/  `, origin),
    "nikos-plumber",
  );
  for (const value of [
    "https://cards.example.com.attacker.test/c/nikos",
    "https://attacker.test/c/nikos",
    "https://name@cards.example.com/c/nikos",
    `${origin}/c/nikos?redirect=https://attacker.test`,
    `${origin}/c/nikos#foo`,
    `${origin}/c/../api/cards`,
    `${origin}/c/ni%6bos`,
    `${origin}/c/UPPER`,
    `${origin}/c/`,
    `${origin}/c/${"a".repeat(81)}`,
    "javascript:alert(1)",
    "tel:12345678",
    "portofolio://c/nikos",
    "not a link",
  ])
    assert.equal(parseTrustedCardLink(value, origin), null, value);
});
test("HTTP is allowed only by an explicit development option, still bound to origin", () => {
  const lan = "http://192.168.1.5:3000";
  assert.equal(parseTrustedCardLink(`${lan}/c/nikos`, lan), null);
  assert.equal(parseTrustedCardLink(`${lan}/c/nikos`, lan, true), "nikos");
  assert.equal(
    parseTrustedCardLink("http://192.168.1.6:3000/c/nikos", lan, true),
    null,
  );
  assert.equal(
    parseTrustedCardLink(
      "ftp://cards.example.com/c/nikos",
      "ftp://cards.example.com",
      true,
    ),
    null,
  );
});
