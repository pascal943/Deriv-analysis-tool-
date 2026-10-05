import http from "node:http";
import { readFile } from "node:fs/promises";
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/deriv.js", ["deriv.js", "text/javascript"]],
  ["/engine.js", ["engine.js", "text/javascript"]],
  ["/signals.js", ["signals.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
]);
http
  .createServer(async (req, res) => {
    const file = files.get(req.url?.split("?")[0]);
    if (!file || req.method !== "GET") {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(new URL(`./web/${file[0]}`, import.meta.url));
      res
        .writeHead(200, {
          "Content-Type": `${file[1]}; charset=utf-8`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'self'; connect-src 'self' https://api.derivws.com wss://api.derivws.com; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        })
        .end(body);
    } catch {
      res.writeHead(500).end("Unable to load application");
    }
  })
  .listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log("Deriv workspace ready"),
  );
