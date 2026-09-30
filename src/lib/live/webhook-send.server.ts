/**
 * Webhook delivery that cannot be steered into a private network.
 *
 * `checkWebhookUrl` refuses IP literals and internal names when the URL is
 * saved, but a public host name can still resolve to 10.x, 127.x or a cloud
 * metadata address. The check therefore runs on the connection itself: the
 * request resolves the name through `guardedLookup`, which refuses unless
 * every address is public, and the socket connects to exactly the address
 * that was checked (no second lookup to rebind). Redirects are not followed.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

const TIMEOUT_MS = 5_000;

type V4 = [number, number, number, number];

/** [prefix, bits] ranges that are not publicly routable (RFC 6890 and friends). */
const V4_BLOCKED: Array<[V4, number]> = [
  [[0, 0, 0, 0], 8], // this network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, broadcast
];

function v4Parts(ip: string): V4 | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (p as V4) : null;
}

function v4Public(p: V4): boolean {
  const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  return !V4_BLOCKED.some(([base, bits]) => {
    const b = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}

/** Eight 16-bit groups, with `::` expanded and a trailing dotted quad folded in. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0]!;
  const quad = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (quad) {
    const p = v4Parts(quad[1]!);
    if (!p) return null;
    s = s.slice(0, -quad[1]!.length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * True only for a globally routable unicast address. IPv6 is allowed only in
 * 2000::/3, minus documentation, Teredo and 6to4; an IPv4-mapped address is
 * judged as the IPv4 address it carries.
 */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.split("%")[0]!);
  if (kind === 4) {
    const p = v4Parts(ip);
    return p !== null && v4Public(p);
  }
  if (kind !== 6) return false;
  const g = v6Groups(ip);
  if (!g) return false;
  // ::ffff:a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return v4Public([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  if (g[0]! < 0x2000 || g[0]! > 0x3fff) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0x0000)) return false; // documentation, Teredo
  if (g[0] === 0x2002) return false; // 6to4 embeds an arbitrary IPv4 address
  return true;
}

type Resolver = (host: string, opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * A `lookup` for `https.request` that resolves every address for the host and
 * refuses the connection unless all of them are public.
 */
export function guardedLookup(resolve: Resolver = dnsLookup as unknown as Resolver) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, "");
      const usable = addresses.filter((a) => !options.family || a.family === options.family);
      const blocked = addresses.find((a) => !isPublicAddress(a.address));
      if (blocked || usable.length === 0) {
        const e: NodeJS.ErrnoException = new Error(blocked ? `${hostname} resolves to a non-public address` : `${hostname} has no usable address`);
        e.code = "EBLOCKED";
        return callback(e, "");
      }
      if (options.all) callback(null, usable);
      else callback(null, usable[0]!.address, usable[0]!.family);
    });
  };
}

export interface WebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** POST a webhook through the guarded lookup. Resolves with the HTTP status; 3xx is not followed. */
export function postWebhook(url: string, init: WebhookRequest, lookup = guardedLookup()): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method, headers: init.headers, lookup: lookup as never, timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      resolve({ ok: status >= 200 && status < 300, status });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(init.body);
  });
}
