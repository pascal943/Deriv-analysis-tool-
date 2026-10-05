import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

for (const host of [undefined, "0.0.0.0"]) {
  test(`server binds to ${host ?? "127.0.0.1 by default"}`, () => {
    const env = { ...process.env, PORT: "0" };
    delete env.HOST;
    if (host) env.HOST = host;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import http from 'node:http';
      const listen = http.Server.prototype.listen;
      http.Server.prototype.listen = function (...args) {
        this.once('listening', () => {
          console.log(JSON.stringify(this.address()));
          this.close();
        });
        return listen.apply(this, args);
      };
      await import(${JSON.stringify(new URL("../server.mjs", import.meta.url).href)});
    `,
      ],
      { env, encoding: "utf8", timeout: 5000 },
    );
    const address = JSON.parse(
      output.split("\n").find((line) => line.startsWith("{")),
    );
    assert.equal(address.address, host ?? "127.0.0.1");
    assert.equal(address.family, "IPv4");
    assert.ok(address.port > 0);
  });
}
