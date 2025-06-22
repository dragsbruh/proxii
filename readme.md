# proxii >~<

**proxii** is a lightweight reverse proxy written in [bun](https://bun.sh), with support for websockets (experimental), and basic analytics collection. (also experimental)
you can define services with a simple `proxii.yaml`

> still early

---

## features

- reverse proxying with per-host/path rules
- built-in request analytics (libsql via drizzle)
- experimental websocket proxying
- configurable via yaml (see below)
- tiny, dependency-light, bun-native

---

## installation

```bash
bun install
```

then run proxii:

```bash
bun start
```

make sure to have a `proxii.yaml` in the working directory.

---

## configuration (`proxii.yaml`)

```yaml
# this is my actual proxii configuration at the time of writing
port: 80
services:
  - name: gitea
    origin: http://127.0.0.1:9001
    basePath: /tea
    host:
      - git.local
      - waifustation.miku-royal.ts.net
```

### service fields

| field      | description                                                                    |
| ---------- | ------------------------------------------------------------------------------ |
| `name`     | display name for the service                                                   |
| `origin`   | the upstream target (where to forward requests)                                |
| `host`     | optional. limit to specific `host` headers                                     |
| `basePath` | optional. limit to requests under a specific path                              |
| `trimBase` | optional. defaults to `true`. whether to remove `basePath` from forwarded path |

---

## analytics (wip)

proxii tracks basic analytics for each request:

```ts
{
  id, // ulid
    timestamp, // request start time
    method,
    url,
    origin, // full upstream url
    statusCode,
    referer,
    userAgent,
    ipAddress,
    forwardedFor, // x-forwarded-for
    bytesSent,
    bytesReceived,
    durationMs;
}
```

currently stored using drizzle with libsql.

---

## websocket support

proxii supports proxying websocket connections (experimental).

- connections are piped bidirectionally
- analytics are tracked

---

## license

licensed under the [apache license 2.0](./license).

---

## todo

- [ ] check everything if forwarding is done right, there were some issues
- [ ] metrics dashboard
