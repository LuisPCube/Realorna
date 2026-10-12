import assert from "node:assert/strict";
import test from "node:test";
import { amountsMatch, createOrderId, signatureHex, verifyMidtransSignature } from "./midtrans.ts";

test("order id memakai awalan ro_, waktu, dan 8 hex", () => {
  const id = createOrderId();
  assert.match(id, /^ro_\d{10,}_[a-f0-9]{8}$/);
  assert.notEqual(createOrderId(), id);
});

test("signature SHA512 cocok dengan rumus Midtrans", () => {
  const hex = signatureHex("ro_1_abcdabcd", "200", "3000.00", "SB-server");
  assert.equal(hex.length, 128);
  assert.equal(
    verifyMidtransSignature(
      {
        order_id: "ro_1_abcdabcd",
        status_code: "200",
        gross_amount: "3000.00",
        signature_key: hex,
      },
      "SB-server",
    ),
    true,
  );
  assert.equal(
    verifyMidtransSignature(
      {
        order_id: "ro_1_abcdabcd",
        status_code: "200",
        gross_amount: "3000.00",
        signature_key: "ab".repeat(64),
      },
      "SB-server",
    ),
    false,
  );
});

test("nominal webhook harus sama dengan pesanan", () => {
  assert.equal(amountsMatch(3000, "3000.00"), true);
  assert.equal(amountsMatch(3000, 3000), true);
  assert.equal(amountsMatch(3000, "10000.00"), false);
});
