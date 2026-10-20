const net = require("node:net");

const originalListen = net.Server.prototype.listen;

net.Server.prototype.listen = function listen(...args) {
  const first = args[0];
  const second = args[1];
  if (typeof first === "number" && (second === undefined || typeof second === "function")) {
    args.splice(1, 0, "127.0.0.1");
  }
  return originalListen.apply(this, args);
};
