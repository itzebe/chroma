/**
 * Network address classification for SSRF defence.
 *
 * Every address a server-side fetch could reach is either "public" (routable on
 * the open internet) or "blocked" (loopback, private, link-local, carrier-grade
 * NAT, multicast, documentation, benchmarking or otherwise internal). Only
 * public addresses may be fetched.
 *
 * Deliberately dependency-free and pure, so it can be tested exhaustively
 * without a network.
 */

import { isIP } from "node:net";

/** True when an IPv4 dotted-quad falls in a range we must never fetch. */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return true; // malformed: refuse rather than guess
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && octets[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups, resolving `::` and any
 * embedded dotted-quad tail. Returns null when the address cannot be parsed.
 */
function expandIpv6(address: string): number[] | null {
  let input = address.toLowerCase();
  const zone = input.indexOf("%");
  if (zone !== -1) input = input.slice(0, zone); // strip scope id (fe80::1%eth0)

  // An embedded IPv4 tail (e.g. ::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = input.lastIndexOf(":");
  const tail = input.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    input = `${input.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = input.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;

  const missing = 8 - head.length - tailGroups.length;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tailGroups];
  if (groups.length !== 8) return null;

  const parsed = groups.map((g) => (g === "" ? NaN : parseInt(g, 16)));
  if (parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  return parsed;
}

/** True when an IPv6 address falls in a range we must never fetch. */
function isBlockedIpv6(address: string): boolean {
  const g = expandIpv6(address);
  if (!g) return true; // unparseable: refuse rather than guess

  if (g.every((n) => n === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1 loopback

  // IPv4-mapped (::ffff:0:0/96) and IPv4-translated (64:ff9b::/96): judge the v4.
  const mapped = g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff;
  const translated = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0);
  if (mapped || translated) {
    return isBlockedIpv4(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
  }

  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return true; // 2002::/16 6to4 can encapsulate private v4
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // 2001::/32 Teredo
  return false;
}

/** Classify a single literal IP address. Non-IP strings are "blocked". */
export function classifyAddress(address: string): "public" | "blocked" {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address) ? "blocked" : "public";
  if (version === 6) return isBlockedIpv6(address) ? "blocked" : "public";
  return "blocked";
}

/** True when a literal IP address must not be fetched. */
export function isBlockedAddress(address: string): boolean {
  return classifyAddress(address) !== "public";
}

/**
 * True when a hostname must never be fetched by name, independently of how it
 * resolves. Catches `localhost`, `.localhost`, `.local`, `.internal` and any
 * bare label (a single label cannot be a public DNS name).
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (isIP(host) !== 0) return isBlockedAddress(host);
  if (!host.includes(".")) return true; // bare label: internal
  return false;
}
