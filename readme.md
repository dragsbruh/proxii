# proxii >\~<

**proxii** is a lightweight reverse proxy written in [bun](https://bun.sh), supporting websockets and static file serving. services are defined declaratively in a `proxii.yaml`.

> still early

---

## features

- reverse proxying with per-host and per-path filters
- experimental websocket proxying
- yaml-based configuration

---

## installation

```bash
bun install
```

Then, run:

```bash
bun start
```

make sure `proxii.yaml` is in the working directory or in one of the standard paths (`/etc/proxii`, `/app`, or cwd etc).

---

## configuration (`proxii.yaml`)

```yaml
port: 80
services:
  - name: gitea
    target:
      origin: http://127.0.0.1:9001
    basePath: /tea
    host:
      - git.local
      - waifustation.miku-royal.ts.net
  - name: .well-known
    target:
      serveStatic: true
      staticDir: ./data/.well-known
    basePath: /.well-known
    host:
      - waifustation.miku-royal.ts.net
```

### Service Fields

| Field       | Description                                                                |
| ----------- | -------------------------------------------------------------------------- |
| `name`      | Display name for the service                                               |
| `origin`    | URL to forward requests to (overridden by `serveStatic` if set)            |
| `staticDir` | If `serveStatic` is `true`, path to serve static files from                |
| `host`      | Optional. One or more host headers to match (string or array of strings)   |
| `basePath`  | Optional. Only match requests starting with this path                      |
| `trimBase`  | Optional. Defaults to `true`. If set, removes `basePath` from request path |

Only one of `origin` or `staticDir` should be defined (based on `serveStatic: true|false`).

---

## websocket support

websocket connections are supported (experimental):

- bidirectional piping

---

## license

licensed under the [apache license 2.0](./LICENSE).

---

## todo

- [ ] verify forwarding logic
