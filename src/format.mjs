import * as core from "@actions/core";
import { context } from "@actions/github";
import { exec } from "@actions/exec";
import { findTerraformCLI } from "./find-cli.mjs";
import { createReview } from "./create-review.mjs";

let createAReview = false;
if (core.getBooleanInput("create-review", { required: true })) {
  if (context.payload.pull_request) {
    createAReview = true;
  } else {
    core.warning(
      "Can only create a review for pull_request events. Ignoring create-review input"
    );
  }
}

core.debug("Starting Terraform formatting validation");

const terraformCLI = await findTerraformCLI();
core.debug(`Terraform CLI found at ${terraformCLI}`);

if (core.getBooleanInput("init", { required: true })) {
  core.startGroup("Running terraform init");
  await exec(terraformCLI, ["init", "-backend=false"]);
  core.endGroup();
}

let stdout = "";
let stderr = "";
const options = {
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
let args = ["fmt", "-check"];
if (core.getBooleanInput("recursive", { required: true })) {
  args.push("-recursive");
}
core.debug(`Running: terraform fmt ${args.join(" ")}`);
const exitCode = await exec(terraformCLI, args, options);
core.debug(`Terraform fmt exit code: ${exitCode}`);
switch (exitCode) {
  case 0:
    core.info("Terraform configuration is formatted correctly");
    await core.summary
      .addHeading(":white_check_mark: Formatting is correct")
      .write();
    process.exit();
  case 3:
    // Terraform fmt returns 3 if there are formatting errors to be corrected
    break;
  default:
    core.setFailed(`Terraform fmt failed with exit code ${exitCode}`);
}
const files = stdout.split("\n").filter((line) => line.trim() !== "");

let summary = await core.summary
  .addHeading(":x: Formatting needs to be updated")
  .addSeparator()
  .addRaw(`Found ${files.length} files with formatting issues`, true)
  .addList(files);

if (!createAReview) {
  summary.addRaw(
    "Please run `terraform fmt` locally to fix the formatting issues",
    true
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
  core.startGroup("Running terraform fmt to correct the formatting issues");
  args = ["fmt"];
  if (core.getBooleanInput("recursive", { required: true })) {
    args.push("-recursive");
  }
  await exec(terraformCLI, args, { ignoreReturnCode: true, silent: true });
  core.endGroup();

  await createReview(`
    # Terraform Formatting Review
    Some files in this pull request have formatting issues. Please run \`terraform fmt\` to fix them.
  `);
}
core.setFailed("Terraform formatting needs to be updated");
