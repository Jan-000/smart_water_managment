import { spawn } from "node:child_process";

const commands = [
  ["shared", ["run", "dev", "--workspace", "shared"]],
  ["backend:build", ["run", "dev:build", "--workspace", "backend"]],
  ["backend", ["run", "dev", "--workspace", "backend"]],
  ["frontend", ["run", "dev", "--workspace", "frontend"]]
];

const children = [];
let stopping = false;

function stopAll(signal = "SIGTERM") {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const [name, args] of commands) {
  const child = spawn("npm", args, {
    stdio: "inherit"
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    console.log(`${name} dev server exited (${signal ?? code ?? 0}).`);
    process.exitCode = code ?? 1;
    stopAll();
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
