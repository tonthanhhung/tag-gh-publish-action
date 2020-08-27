#!/usr/bin/env node
const core = require("@actions/core");
const github = require("@actions/github");

const process = require("process");
const { join } = require("path");
const { spawn } = require("child_process");
const { readFile } = require("fs");

async function main() {
  const dir =
    process.env.WORKSPACE ||
    process.env.GITHUB_WORKSPACE ||
    "/github/workspace";

  const eventFile =
    process.env.GITHUB_EVENT_PATH || "/github/workflow/event.json";
  const eventObj = await readJson(eventFile);

  const commitPattern =
    getEnv("COMMIT_PATTERN") || "^(?:Release|Version) (\\S+)";

  const { name, email } = eventObj.repository.owner;

  const config = {
    commitPattern,
    tagAuthor: { name, email }
  };
  await processDirectory(dir, config);
}

function getEnv(name) {
  return process.env[name] || process.env[`INPUT_${name}`];
}

async function getVersion(dir) {
  const packageFile = join(dir, "package.json");
  const packageObj = await readJson(packageFile).catch(() =>
    Promise.reject(
      new NeutralExitError(`package file not found: ${packageFile}`)
    )
  );

  if (packageObj == null || packageObj.version == null) {
    throw new Error("missing version field!");
  }

  const { version } = packageObj;
  return version;
}

async function processDirectory(dir, config) {
  let version = await getVersion(dir);

  await gitSetup(dir, config);
  await addBuiltPackage(dir);
  await run(dir, "git", "tag", "-a", "-m", `Release ${version}`, `v${version}`);
  await run(dir, "git", "push", "origin", `refs/tags/v${version}`);
  console.log("Done.");
}

async function readJson(file) {
  const data = await new Promise((resolve, reject) =>
    readFile(file, "utf8", (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    })
  );
  return JSON.parse(data);
}

async function gitSetup(dir, config) {
  const { name, email } = config.tagAuthor;
  await run(dir, "git", "config", "user.name", name);
  await run(dir, "git", "config", "user.email", email);
}

async function addBuiltPackage(dir) {
  await run(dir, "yarn");
  await run(dir, "yarn", "build");
  await run(dir, "git", "add", "-f", "dist");
}

function run(cwd, command, ...args) {
  console.log("Executing:", command, args.join(" "));
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"]
    });
    const buffers = [];
    proc.stderr.on("data", data => buffers.push(data));
    proc.on("error", () => {
      reject(
        new Error(`
  command
  failed: ${command}`)
      );
    });
    proc.on("exit", code => {
      if (code === 0) {
        resolve(true);
      } else {
        const stderr = Buffer.concat(buffers).toString("utf8").trim();
        if (stderr) {
          console.log(`
  command
  failed
  with code ${code}`);
          console.log(stderr);
        }
        reject(new ExitError(code));
      }
    });
  });
}

class ExitError extends Error {
  constructor(code) {
    super(`command
  failed
  with code ${code}`);
    this.code = code;
  }
}

class NeutralExitError extends Error {}

if (require.main === module) {
  main().catch(e => {
    if (e instanceof NeutralExitError) {
      // GitHub removed support for neutral exit code:
      // https://twitter.com/ethomson/status/1163899559279497217
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
      console.log(e.message || e);
    }
  });
}
