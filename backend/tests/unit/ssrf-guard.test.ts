import { describe, expect, it } from "vitest";
import { isPublicUnicastIp, validateWebhookUrlSyntax, SsrfValidationError } from "../../src/lib/ssrf-guard";

describe("validateWebhookUrlSyntax", () => {
  it("accepts a well-formed https URL with a multi-label public hostname", () => {
    expect(validateWebhookUrlSyntax("https://hooks.example.com/cms")).toEqual({ hostname: "hooks.example.com" });
  });

  it("accepts an explicit :443 port", () => {
    expect(() => validateWebhookUrlSyntax("https://hooks.example.com:443/cms")).not.toThrow();
  });

  it("rejects http://", () => {
    expect(() => validateWebhookUrlSyntax("http://hooks.example.com")).toThrow(SsrfValidationError);
  });

  it("rejects URLs carrying credentials", () => {
    expect(() => validateWebhookUrlSyntax("https://user:pass@hooks.example.com")).toThrow(SsrfValidationError);
  });

  it("rejects non-443 ports", () => {
    expect(() => validateWebhookUrlSyntax("https://hooks.example.com:8443")).toThrow(SsrfValidationError);
  });

  it("rejects a literal IPv4 host", () => {
    expect(() => validateWebhookUrlSyntax("https://93.184.216.34")).toThrow(SsrfValidationError);
  });

  it("rejects a literal IPv6 host", () => {
    expect(() => validateWebhookUrlSyntax("https://[2606:2800:220:1:248:1893:25c8:1946]")).toThrow(SsrfValidationError);
  });

  it("rejects single-label hostnames", () => {
    expect(() => validateWebhookUrlSyntax("https://localhost")).toThrow(SsrfValidationError);
    expect(() => validateWebhookUrlSyntax("https://internalhost")).toThrow(SsrfValidationError);
  });

  it("rejects known internal TLD-like suffixes", () => {
    for (const host of ["svc.internal", "app.local", "db.lan", "box.home.arpa", "pod.cluster.local", "site.localhost"]) {
      expect(() => validateWebhookUrlSyntax(`https://${host}`)).toThrow(SsrfValidationError);
    }
  });

  it("rejects malformed URLs", () => {
    expect(() => validateWebhookUrlSyntax("not a url")).toThrow(SsrfValidationError);
  });

  it("rejects URLs longer than 2048 characters", () => {
    const longPath = "a".repeat(2100);
    expect(() => validateWebhookUrlSyntax(`https://hooks.example.com/${longPath}`)).toThrow(SsrfValidationError);
  });
});

describe("isPublicUnicastIp", () => {
  it("rejects private/loopback/link-local IPv4 ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPublicUnicastIp(ip)).toBe(false);
    }
  });

  it("accepts a public IPv4 address", () => {
    expect(isPublicUnicastIp("93.184.216.34")).toBe(true);
  });

  it("rejects IPv6 loopback/link-local/ULA", () => {
    expect(isPublicUnicastIp("::1")).toBe(false);
    expect(isPublicUnicastIp("fe80::1")).toBe(false);
    expect(isPublicUnicastIp("fc00::1")).toBe(false);
  });

  it("accepts a public IPv6 address", () => {
    expect(isPublicUnicastIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("unwraps IPv4-mapped IPv6 (::ffff:127.0.0.1) and rejects it", () => {
    expect(isPublicUnicastIp("::ffff:127.0.0.1")).toBe(false);
  });

  it("unwraps NAT64-mapped IPv6 and rejects a private embedded IPv4", () => {
    expect(isPublicUnicastIp("64:ff9b::a9fe:a9fe")).toBe(false); // 169.254.169.254 embedded
  });

  it("rejects non-IP strings", () => {
    expect(isPublicUnicastIp("not-an-ip")).toBe(false);
  });
});
