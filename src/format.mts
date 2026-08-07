import * as core from "@actions/core";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { context, getOctokit } from "@actions/github";
import { exec } from "@actions/exec";
import getChanges from "@owretch/git-diff";
import type { Change } from "@owretch/git-diff";

const tfFiles = new Set([
	"*.tf",
	"*.tfvars",
	"*.tftest.hcl",
	"*.tofu",
	"*.tofutest.hcl",
]);

core.info("Starting Terraform formatting validation");

// Setup flags to control execution
let createAReview = false;
if (core.getBooleanInput("create_review", { required: true })) {
	if (context.eventName === "pull_request") {
		core.debug("Will create a review for the formatting issues");
		createAReview = true;
	} else {
		core.warning(
			"Can only create a review for pull_request events. Ignoring create-review input",
		);
	}
}
let strictMode = false;
if (core.getBooleanInput("strict_mode", { required: true })) {
	core.debug("Strict mode enabled. Will fail if formatting is incorrect");
	strictMode = true;
}

// Get the working directory
let workingDirectory = process.env.GITHUB_WORKSPACE ?? ".";
if (core.getInput("working_directory") !== workingDirectory) {
	let userWorkingDirectory = core.getInput("working_directory");
	if (!path.isAbsolute(userWorkingDirectory)) {
		userWorkingDirectory = path.join(
			process.env.GITHUB_WORKSPACE ?? "",
			core.getInput("working_directory"),
		);
	}
	if (fs.existsSync(userWorkingDirectory)) {
		workingDirectory = userWorkingDirectory;
	} else {
		core.setFailed(`Working directory ${userWorkingDirectory} does not exist`);
	}
}

// Get the Terraform/OpenTofu CLI path
let cliPath = "";
let cliName = "";
const exeSuffix = os.platform().startsWith("win") ? ".exe" : "";

if (core.getInput("cli_path")) {
	cliPath = core.getInput("cli_path");
	if (cliPath === "") {
		throw new Error("CLI path is empty");
	}
	if (!cliPath.endsWith(exeSuffix)) {
		core.debug("Adding exe suffix to CLI path");
		cliPath += exeSuffix;
	}
	core.info(`Using CLI from input: ${cliPath}`);
	if (!fs.existsSync(cliPath)) {
		core.setFailed(`CLI path does not exist: ${cliPath}`);
	}
	cliName = path.basename(cliPath, exeSuffix);
	core.info(`Using ${cliName} CLI from input: ${cliPath}`);
} else if (process.env.TOFU_CLI_PATH) {
	cliPath = path.join(process.env.TOFU_CLI_PATH, `tofu-bin${exeSuffix}`);
	cliName = "tofu";
	core.info(`Using ${cliName} CLI from TOFU_CLI_PATH: ${cliPath}`);
} else if (process.env.TERRAFORM_CLI_PATH) {
	cliPath = path.join(
		process.env.TERRAFORM_CLI_PATH,
		`terraform-bin${exeSuffix}`,
	);
	cliName = "terraform";
	core.info(`Using ${cliName} CLI from TERRAFORM_CLI_PATH: ${cliPath}`);
} else {
	core.setFailed(
		"No CLI path provided, and no Terraform/OpenTofu Setup task detected.",
	);
}

if (!fs.existsSync(cliPath)) {
	core.setFailed(`CLI path does not exist: ${cliPath}`);
}

// Initialize the configuration if requested
if (core.getBooleanInput("init", { required: true })) {
	core.startGroup(`Running ${cliName} init`);
	await exec(cliPath, ["init", "-backend=false"]);
	core.endGroup();
}

// Run a check to see if the configuration is formatted correctly
let stdout = "";
let stderr = "";
const options = {
	cwd: workingDirectory,
	listeners: {
		stdout: (data: Buffer) => {
			stdout += data.toString();
		},
		stderr: (data: Buffer) => {
			stderr += data.toString();
		},
	},
	ignoreReturnCode: true,
	silent: true, // Avoid printing command in stdout: https://github.com/actions/toolkit/issues/649
};
const args = ["fmt"];
if (core.getBooleanInput("recursive", { required: true })) {
	args.push("-recursive");
}
args.push(workingDirectory); // Working directory is the last argument

core.debug(`Running: ${cliName} ${args.join(" ")}`);
const exitCode = await exec(cliPath, args, options);
core.debug(`Exit code: ${exitCode}`);

// Get the changes in the configuration
core.startGroup("Getting changes in the configuration");
const changes = getChanges(tfFiles);
core.endGroup();

if (changes.size === 0) {
	core.info("Configuration is formatted correctly");
	await core.summary
		.addHeading(":white_check_mark: Formatting is correct", 2)
		.write();
	process.exit();
}
const changedFileNames = new Set(
	[...changes]
		.map((change) => change.toFile?.name ?? change.fromFile?.name)
		.filter((f) => f !== undefined),
);
core.info(`Found ${changedFileNames.size} files with formatting issues`);
const summary = core.summary;
if (strictMode) {
	summary.addHeading(":x: Formatting needs to be updated", 2);
} else {
	summary.addHeading(":warning: Formatting needs to be updated", 2);
}
summary
	.addRaw(`Found ${changedFileNames.size} files with formatting issues`, true)
	.addList([...changedFileNames]);

if (!createAReview) {
	summary.addRaw(
		`Please run \`${cliName} fmt\` locally to fix the formatting issues`,
		true,
	);
}
summary.write();

// Create a review to fix the formatting issues if requested
if (createAReview) {
	core.debug("Creating a review for the formatting issues");
	const reviewBody = `\
# Formatting Issues
${changedFileNames.size} files in this pull request have formatting issues. \
Please run \`${cliName} fmt\` to fix them.

<details>

<summary>Files with formatting issues</summary>

${[...changedFileNames].map((n) => `- \`${n}\``).join("\n")}

</details>`;
	await createReview(changes, reviewBody);
} else {
	core.debug("Creating annotations for the formatting issues");
	// Create annotations for each file with formatting issues
	for (const file of changedFileNames) {
		core.warning(`Please run \`${cliName} fmt\` to fix the formatting issues`, {
			title: "Incorrect formatting",
			file: file,
		});
	}
}

if (strictMode) {
	core.debug("Failing due to strict mode");
	core.setFailed("Formatting needs to be updated");
}

core.debug("Exiting despite formatting issues");

const reviewTag = `<!-- Review from ${context.action} -->`;

async function createReview(changes: Set<Change>, reviewBody: string) {
	core.info("Creating a GitHub review");
	if (!context.payload.pull_request) {
		throw new Error("This action can only be run on pull_request events");
	}
	const octokit = getOctokit(core.getInput("token", { required: true }));
	const { pull_request } = context.payload;
	const reviews = await octokit.paginate(
		octokit.rest.pulls.listReviews,
		{
			...context.repo,
			pull_number: pull_request.number,
		},
		(response) =>
			response.data
				.map((review) => {
					if (
						review.user?.type === "Bot" &&
						review.state === "CHANGES_REQUESTED" &&
						review.body?.includes(reviewTag)
					) {
						return review;
					}
				})
				.filter((review) => review !== undefined),
	);

	for (const review of reviews) {
		let message = "Superseeded by new review";
		let commentCloseClassifier = "OUTDATED";
		if (changes.size === 0 && review.id === reviews[reviews.length - 1].id) {
			message = "All formatting issues have been resolved";
			commentCloseClassifier = "RESOLVED";
		}

		const oldComments = await octokit.paginate(
			octokit.rest.pulls.listCommentsForReview,
			{
				...context.repo,
				pull_number: pull_request.number,
				review_id: review.id,
			},
			(response) => response.data,
		);

		for (const comment of oldComments) {
			await octokit.graphql(
				`
					mutation hideComment($id: ID!, $classifier: ReportedContentClassifiers!) {
						minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
							clientMutationId
						}
					}
				`,
				{ id: comment.node_id, classifier: commentCloseClassifier },
			);
		}

		await octokit.graphql(
			`
				mutation hideComment($id: ID!, $classifier: ReportedContentClassifiers!) {
					minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
						clientMutationId
					}
				}
			`,
			{ id: review.node_id, classifier: commentCloseClassifier },
		);
		await octokit.rest.pulls.dismissReview({
			...context.repo,
			pull_number: pull_request.number,
			review_id: review.id,
			message,
		});
	}

	if (changes.size > 0) {
		await octokit.rest.pulls.createReview({
			...context.repo,
			pull_number: pull_request.number,
			event: "REQUEST_CHANGES",
			comments: createComments(changes),
			body: `${reviewBody}\n${reviewTag}`,
		});
	}
}

function createComments(changes: Set<Change>) {
	return [...changes]
		.filter((change) => change.toFile !== undefined)
		.map((change) => {
			const lineCount = Math.max(
				change.fromFile?.line_count ?? 0,
				change.toFile!.line_count,
			);
			const comment: {
				path: string;
				body: string;
				line: number;
				start_line?: number;
			} = {
				path: change.toFile!.name,
				body: "````suggestion\n" + change.toFile!.content + "````",
				line: change.toFile!.start_line,
			};
			if (lineCount > 1) {
				comment.start_line = change.toFile!.start_line;
				comment.line = change.toFile!.start_line + lineCount - 1;
			}
			return comment;
		});
}
