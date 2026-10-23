/**
 * Regression guard for GHSA-86w9-cpqp-85rv.
 *
 * node-forge (<=1.4.0, no patched release) accepted RSA PKCS#1 v1.5 signatures whose
 * DigestInfo carried extra nested DigestAlgorithm elements. The agents package no longer
 * depends on node-forge; RSA signing and verification must use the built-in node:crypto
 * module, which these tests show enforces strict DigestInfo encoding.
 */

import { execFileSync } from "node:child_process";
import { createHash, constants, generateKeyPairSync, privateEncrypt, sign, verify } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const agentsRoot = resolve(__dirname, "../../..");
const repoRoot = resolve(agentsRoot, "..");

describe("node-forge removal", () => {
  it("keeps node-forge out of every manifest and lockfile", () => {
    const output = execFileSync(process.execPath, [resolve(repoRoot, "scripts/verify-no-forge.cjs")], {
      encoding: "utf8",
    });
    expect(output).toContain("verify-no-forge: ok");
  });

  it("cannot resolve node-forge from the agents package", () => {
    const load = createRequire(resolve(agentsRoot, "package.json"));
    expect(() => load.resolve("node-forge")).toThrow();
  });
});

describe("node:crypto RSA PKCS#1 v1.5 verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const message = Buffer.from("anvil rsa regression");
  const hash = createHash("sha256").update(message).digest();

  const tlv = (tag: number, content: Buffer): Buffer => {
    if (content.length >= 0x80) throw new Error("fixture only supports short-form lengths");
    return Buffer.concat([Buffer.from([tag, content.length]), content]);
  };
  const sequence = (...children: Buffer[]) => tlv(0x30, Buffer.concat(children));
  const sha256Oid = () => tlv(0x06, Buffer.from("608648016503040201", "hex"));
  const nil = () => tlv(0x05, Buffer.alloc(0));
  const octets = (bytes: Buffer) => tlv(0x04, bytes);

  // Builds an EMSA-PKCS1-v1_5 block around a caller-supplied DigestAlgorithm and signs it raw.
  const forgeSignature = (...algorithm: Buffer[]): Buffer => {
    const digestInfo = sequence(sequence(...algorithm), octets(hash));
    const padding = Buffer.alloc(256 - digestInfo.length - 3, 0xff);
    const block = Buffer.concat([Buffer.from([0x00, 0x01]), padding, Buffer.from([0x00]), digestInfo]);
    return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, block);
  };

  it("round-trips a normal signature", () => {
    const signature = sign("sha256", message, privateKey);
    expect(verify("sha256", message, publicKey, signature)).toBe(true);
    expect(verify("sha256", Buffer.from("tampered"), publicKey, signature)).toBe(false);
  });

  it("accepts the canonical DigestInfo encoding", () => {
    expect(verify("sha256", message, publicKey, forgeSignature(sha256Oid(), nil()))).toBe(true);
  });

  it.each([
    ["NULL plus trailing octet string", () => forgeSignature(sha256Oid(), nil(), octets(Buffer.from("garbage")))],
    ["octet string in place of NULL", () => forgeSignature(sha256Oid(), octets(Buffer.from("garbage")))],
    ["duplicate NULL parameters", () => forgeSignature(sha256Oid(), nil(), nil())],
  ])("rejects DigestAlgorithm with %s", (_label, build) => {
    expect(verify("sha256", message, publicKey, build())).toBe(false);
  });
});
