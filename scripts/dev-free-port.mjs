#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appName,
  buildIdleShutdownCommand,
  isReservedDevPort,
  parseIdleMinutes,
  stableProjectPort,
} from "../src/lib/local-server-utils.mjs";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  console.error(`PsychSift local server requires Node 24.x. Current runtime: ${process.versions.node}.`);
  process.exit(1);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxPort = 65535;

function parseCommand(args) {
  const [firstArg, ...rest] = args;
  if (firstArg === "dev" || firstArg === "start") {
    return { command: firstArg, args: rest };
  }
  return { command: "dev", args };
}

function parsePreferredPort(args) {
  const envPort = Number.parseInt(process.env.PORT ?? "", 10);
  if (Number.isInteger(envPort) && envPort > 0) {
    return { port: envPort, source: "configured" };
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === "--port" || arg === "-p") && args[index + 1]) {
      const parsed = Number.parseInt(args[index + 1], 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { port: parsed, source: "configured" };
      }
    }
    if (arg.startsWith("--port=")) {
      const parsed = Number.parseInt(arg.split("=")[1] ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { port: parsed, source: "configured" };
      }
    }
  }

  return { port: stableProjectPort(projectRoot), source: "stable" };
}

function removePortArgs(args) {
  const cleaned = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) continue;
    cleaned.push(arg);
  }
  return cleaned;
}

function dependencyBundlerArgs(command, args) {
  if (command !== "dev" || args.some((arg) => ["--webpack", "--turbopack", "--turbo"].includes(arg))) {
    return [];
  }

  try {
    const dependenciesPath = fs.realpathSync(path.join(projectRoot, "node_modules"));
    const relativeDependenciesPath = path.relative(projectRoot, dependenciesPath);
    const dependenciesAreExternal =
      relativeDependenciesPath === ".." ||
      relativeDependenciesPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDependenciesPath);
    return dependenciesAreExternal ? ["--webpack"] : [];
  } catch {
    return [];
  }
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => {
      // An unsupported address family (e.g. no IPv6 in the container) cannot
      // hold the port, so it must not disqualify it as busy.
      resolve(error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL");
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function canConnectToHost(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function canListen(port) {
  const hosts = ["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"];
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    if (await canConnectToHost(port, host)) return false;
  }
  for (const host of hosts) {
    if (!(await canListenOnHost(port, host))) return false;
  }
  return true;
}

async function findFreePort(preferredPort) {
  for (let port = preferredPort; port <= maxPort; port += 1) {
    if (isReservedDevPort(port)) continue;
    if (await canListen(port)) return port;
  }
  throw new Error(`No free development port found from ${preferredPort} to ${maxPort}.`);
}

const parsedCommand = parseCommand(process.argv.slice(2));
const forwardedArgs = parsedCommand.args;
const preferred = parsePreferredPort(forwardedArgs);
const preferredPort = preferred.port;
const freePort = await findFreePort(preferredPort);
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const url = `http://localhost:${freePort}`;

if (freePort !== preferredPort) {
  const portKind = preferred.source === "stable" ? "Stable project port" : "Configured port";
  console.log(`${portKind} ${preferredPort} was busy; using ${url} instead.`);
} else {
  const portKind = preferred.source === "stable" ? "stable project port" : "configured port";
  console.log(`Starting ${appName} at ${url} (${portKind}).`);
}

if (forwardedArgs.includes("--print-port")) {
  process.exit(0);
}

const idleMinutes = parseIdleMinutes(process.env.DEV_SERVER_IDLE_MINUTES);
const idleTimeoutMs = idleMinutes === null ? null : idleMinutes * 60_000;
const idleCheckIntervalMs = 60_000;

if (idleTimeoutMs !== null) {
  console.log(`Idle shutdown enabled: this server exits after ${idleMinutes} min with no request/build activity.`);
}

const nodeOptions = process.env.NODE_OPTIONS ?? "";
const effectiveNodeOptions = nodeOptions.includes("--max-old-space-size")
  ? nodeOptions
  : `${nodeOptions} --max-old-space-size=4096`.trim();

const child = spawn(
  process.execPath,
  [
    nextBin,
    parsedCommand.command,
    "--hostname",
    "0.0.0.0",
    "--port",
    String(freePort),
    ...removePortArgs(forwardedArgs),
    ...dependencyBundlerArgs(parsedCommand.command, forwardedArgs),
  ],
  {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(freePort), NODE_OPTIONS: effectiveNodeOptions },
    // Idle-shutdown needs to observe output to detect activity, so it cannot
    // use "inherit"; everything read here is still forwarded byte-for-byte.
    stdio: idleTimeoutMs === null ? "inherit" : ["ignore", "pipe", "pipe"],
  },
);

let idleTimer = null;

if (idleTimeoutMs !== null) {
  let lastActivityAt = Date.now();
  const markActivity = () => {
    lastActivityAt = Date.now();
  };
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    markActivity();
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    markActivity();
  });

  idleTimer = setInterval(() => {
    const idleForMs = Date.now() - lastActivityAt;
    if (idleForMs < idleTimeoutMs) return;
    console.log(
      `No activity for ${Math.round(idleForMs / 60_000)} min (limit ${idleMinutes} min); shutting down idle ${appName} dev server on port ${freePort}.`,
    );
    clearInterval(idleTimer);
    const shutdownCommand = buildIdleShutdownCommand(child.pid);
    if (shutdownCommand.kind === "taskkill") {
      // Windows: no signal-based way to ask the process tree to exit
      // gracefully, so terminate next-dev and its forked server process in
      // one call instead of racing a signal that only the wrapper receives.
      execFile(shutdownCommand.command, shutdownCommand.args, () => {
        // Best effort — if taskkill itself fails, the process is most likely
        // already gone; the wrapper's own `exit` handler covers the rest.
      });
    } else {
      child.kill(shutdownCommand.signal);
      const forceKill = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 10_000);
      forceKill.unref();
    }
  }, idleCheckIntervalMs);
  idleTimer.unref();
}

child.on("exit", (code, signal) => {
  if (idleTimer) clearInterval(idleTimer);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
