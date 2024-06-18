import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "@actions/exec";
import { findTerraformCLI } from "./find-cli.mjs";

const createReview = core.getBooleanInput("create-review", { required: true });

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
// if (!createReview) {
//   args.push("-check");
// }
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
    // Terraform fmt returns 3 if there are formatting errors to be made
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

if (!createReview) {
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
if (createReview) {
  core.info("Creating a review to fix the formatting issues");
  core.debug(
    `The context info: ${JSON.stringify(github.context, undefined, 2)}`
  );
  // const { owner, repo } = github.context.repo;
  // const { data: pullRequest } = await octokit.pulls.get({
  //   owner,
  //   repo,
  //   pull_number: pullRequestNumber,
  // });
  // const { data: reviews } = await octokit.pulls.listReviews({
  //   owner,
  //   repo,
  //   pull_number: pullRequestNumber,
  // });
  // const reviewId = reviews.find(
  //   (review) => review.user.login === "github-actions[bot]"
  // )?.id;
  // if (reviewId) {
  //   await octokit.pulls.deleteReview({
  //     owner,
  //     repo,
  //     pull_number: pullRequestNumber,
  //     review_id: reviewId,
  //   });
  // }
  // await octokit.pulls.createReview({
  //   owner,
  //   repo,
  //   pull_number: pullRequestNumber,
  //   commit_id: pullRequest.head.sha,
  //   body: "Please run `terraform fmt` to fix the formatting issues",
  //   event: "REQUEST_CHANGES",
  // });
  core.info("Review created");
}
core.setFailed("Terraform formatting needs to be updated");
