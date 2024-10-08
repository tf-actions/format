import * as core from "@actions/core";
import * as os from "node:os";
import * as path from "node:path";
import { context } from "@actions/github";
import { exec } from "@actions/exec";
import { findCLI } from "./lib/find-cli.mjs";
import { createReview } from "./lib/create-review.mjs";

let createAReview = false;
if (core.getBooleanInput("create-review", { required: true })) {
	if (context.payload.pull_request) {
		createAReview = true;
	} else {
		core.warning(
			"Can only create a review for pull_request events. Ignoring create-review input",
		);
	}
}

let workingDirectory = process.env.GITHUB_WORKSPACE;
if (core.getInput("working_directory")) {
	workingDirectory = path.join(
		workingDirectory,
		core.getInput("working_directory"),
	);
}

core.debug("Starting Terraform formatting validation");

const cli = await findCLI();
let cliName = "";
switch (cli.split(path.sep).pop()) {
	case "tofu":
	case "tofu-bin":
		cliName = "tofu";
		break;
	case "terraform":
	case "terraform-bin":
		cliName = "terraform";
		break;
	default:
		cliName = cli.split(path.sep).pop();
}

if (core.getBooleanInput("init", { required: true })) {
	await exec(cli, ["init", "-backend=false"]);
}

let stdout = "";
let stderr = "";
const options = {
	cwd: workingDirectory,
	listeners: {
		stdout: (data) => {
			stdout += data.toString();
		},
		stderr: (data) => {
			stderr += data.toString();
		},
	},
	ignoreReturnCode: true,
	silent: true, // avoid printing command in stdout: https://github.com/actions/toolkit/issues/649
};
const args = ["fmt"];
if (!createAReview) {
	args.push("-check");
}
if (core.getBooleanInput("recursive", { required: true })) {
	args.push("-recursive");
}
// Working directory is the last argument
args.push(workingDirectory);

core.debug(`Running: ${cli} ${args.join(" ")}`);
const exitCode = await exec(cli, args, options);
core.debug(`Exit code: ${exitCode}`);
switch (exitCode) {
	case 0:
		core.info("Configuration is formatted correctly");
		await core.summary
			.addHeading(":white_check_mark: Formatting is correct")
			.write();
		process.exit();
		break;
	case 3:
		// Terraform fmt returns 3 if there are formatting errors to be corrected
		break;
	default:
		core.setFailed(`${cliName} fmt failed with exit code ${exitCode}`);
		process.exit(exitCode);
}
const files = stdout.split("\n").filter((line) => line.trim() !== "");

const summary = core.summary
	.addHeading(":x: Formatting needs to be updated")
	.addSeparator()
	.addRaw(`Found ${files.length} files with formatting issues`, true)
	.addList(files);

if (!createAReview) {
	summary.addRaw(
		`Please run \`${cliName} fmt\` locally to fix the formatting issues`,
		true,
	);
}
summary.write();

// Create annotations for each file with formatting issues
for (const file of files) {
	const properties = {
		title: "Incorrect formatting",
		file: file,
	};
	core.error(`Incorrect formatting in ${file}`, properties);
}

// Create a review to fix the formatting issues if requested
if (createAReview) {
	core.info("Creating a review to fix the formatting issues");
	await createReview();
}
core.setFailed("Formatting needs to be updated");
