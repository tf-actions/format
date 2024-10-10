import * as core from "@actions/core";
import * as path from "node:path";
import { fs } from "node:fs";
import { context } from "@actions/github";
import { exec } from "@actions/exec";
import { findCLI } from "./lib/find-cli.mjs";
import { createReview } from "./lib/create-review.mjs";

core.info("Starting Terraform formatting validation");

let createAReview = false;
if (core.getBooleanInput("create_review", { required: true })) {
	if (context.payload.pull_request) {
		createAReview = true;
	} else {
		core.warning(
			"Can only create a review for pull_request events. Ignoring create-review input",
		);
	}
}

let workingDirectory = process.env.GITHUB_WORKSPACE;
if (core.getInput("working_directory") !== workingDirectory) {
	let userWorkingDirectory = core.getInput("working_directory");
	if (!path.isAbsolute(userWorkingDirectory)) {
		userWorkingDirectory = path.join(
			process.env.GITHUB_WORKSPACE,
			core.getInput("working_directory"),
		);
	}
	if (fs.existsSync(userWorkingDirectory)) {
		workingDirectory = userWorkingDirectory;
	} else {
		core.setFailed(`Working directory ${userWorkingDirectory} does not exist`);
	}
}

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
	core.startGroup("Running terraform init");
	await exec(cli, ["init", "-backend=false"]);
	core.endGroup();
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
const args = ["fmt", "-check"];
if (core.getBooleanInput("recursive", { required: true })) {
	args.push("-recursive");
}
// Working directory is the last argument
args.push(workingDirectory);

core.debug(`Running: ${cli} ${args.join(" ")}`);
const exitCode = await exec(cli, args, options);
core.debug(`Exit code: ${exitCode}`);

if (exitCode === 0) {
	core.info("Configuration is formatted correctly");
	await core.summary
		.addHeading(":white_check_mark: Formatting is correct", 2)
		.write();
	process.exit();
}
const files = stdout
	.split("\n")
	.filter((line) => line.trim() !== "")
	.filter((line) => !line.startsWith("::"));
core.debug(`stdout: ${stdout}`);
core.info(`Found ${files.length} files with formatting issues`);
core.debug(`Files: ${files.join(", ")}`);

const summary = core.summary
	.addHeading(":x: Formatting needs to be updated", 2)
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
	// Run the formatting command to fix the issues
	core.debug(`Running ${cliName} fmt to fix the formatting issues`);
	const args = ["fmt"];
	if (core.getBooleanInput("recursive", { required: true })) {
		args.push("-recursive");
	}
	// Working directory is the last argument
	args.push(workingDirectory);
	await exec(cli, args, options);

	core.info("Creating a review for the formatting issues");
	await createReview(cliName);
}
core.setFailed("Formatting needs to be updated");
