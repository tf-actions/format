import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getChanges,
  createReviewComments,
} from "./review-comments-from-git-diff.mjs";

export async function createReview(reviewBody) {
  // const reviewBody =
  //   "# Terraform Formatting Review\nSome files in this pull request have formatting issues. Please run `terraform fmt` to fix them.";
  core.startGroup("Creating code review");

  core.debug("Creating octokit client");
  const octokit = github.getOctokit(core.getInput("token", { required: true }));

  // Get list of files in the current pull request.
  // This means that we only post comments for files that have been changed in the PR.
  let response = await octokit.rest.pulls.listFiles({
    ...github.context.payload.repository,
    pull_number: github.context.payload.number,
    // owner: "SoliDeoGloria-Tech",
    // repo: "workflow-testing",
    // pull_number: 1,
  });
  const pullRequestFiles = response.data.map((file) => file.filename);
  console.debug(`pullRequestFiles: ${JSON.stringify(pullRequestFiles)}`);

  const changes = await getChanges(pullRequestFiles);
  const comments = createReviewComments(changes);

  // Find the existing review, if it exists
  core.debug("Listing reviews on the pull request");
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    ...github.context.payload.repository,
    pull_number: github.context.payload.number,
    // owner: "SoliDeoGloria-Tech",
    // repo: "workflow-testing",
    // pull_number: 1,
  });
  core.debug(`Retrieved ${reviews.length} reviews`);
  console.log(`reviews: ${JSON.stringify(reviews)}`);
  core.debug("Finding existing review");
  const reviewId = reviews.find(
    (review) =>
      review.user.type === "Bot" &&
      review.state === "CHANGES_REQUESTED" &&
      review.body === reviewBody
    //   (review) =>
    //     review.user.login === "oWretch" &&
    //     review.state === "COMMENTED" &&
    //     review.body === reviewBody
  )?.id;
  core.debug(`Review ID: ${reviewId}`);

  if (reviewId) {
    core.debug("Dismiss the existing review");
    await octokit.rest.pulls.dismissReview({
      ...github.context.payload.repository,
      pull_number: github.context.payload.number,
      // owner: "SoliDeoGloria-Tech",
      // repo: "workflow-testing",
      // pull_number: 1,
      review_id: reviewId,
      message: "Superseeded by new review",
      event: "DISMISSED",
    });
  }

  // Post a new review if we have comments
  if (comments.length > 0) {
    core.debug("Creating new review");
    await octokit.rest.pulls.createReview({
      ...github.context.payload.repository,
      pull_number: github.context.payload.number,
      // owner: "SoliDeoGloria-Tech",
      // repo: "workflow-testing",
      // pull_number: 1,
      // event: "COMMENT",
      body: reviewBody,
      event: "REQUEST_CHANGES",
      comments,
    });
  }
  core.info("Review created");
  core.endGroup();
}
