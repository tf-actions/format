import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getChanges,
  createReviewComments,
} from "./review-comments-from-git-diff.mjs";
const { context = {} } = github;
const { pull_request } = context.payload;

// const octokit = new Octokit({
//   auth: core.getInput("token", { required: true }),
//   baseUrl: core.getInput("api-url", { required: true }),
// });

export async function createReview(reviewBody) {
  core.startGroup("Creating code review");

  core.debug("Creating octokit client");
  const octokit = github.getOctokit(core.getInput("token", { required: true }));

  // Get list of files in the current pull request.
  // This means that we only post comments for files that have been changed in the PR.
  const pullRequestFileNames = await octokit.paginate(
    octokit.rest.pulls.listFiles,
    {
      ...context.repo,
      pull_number: pull_request.number,
    },
    (response) => response.data.map((file) => file.filename)
  );
  // const pullRequestFileNames = pullRequestFiles.map((file) => file.filename);
  console.debug(
    `pullRequestFileNames: ${JSON.stringify(pullRequestFileNames)}`
  );

  const changes = await getChanges(pullRequestFileNames);
  const comments = createReviewComments(changes);

  // Find the existing review, if it exists
  core.debug("Listing reviews on the pull request");
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    ...context.repo,
    pull_number: pull_request.number,
  });
  core.debug(`Reviews: ${JSON.stringify(reviews)}`);

  const reviewId = reviews.data.find(
    (review) =>
      review.user.type === "Bot" &&
      review.state === "CHANGES_REQUESTED" &&
      review.body === reviewBody
  )?.id;
  core.debug(`Review ID: ${reviewId}`);

  if (reviewId) {
    core.debug("Dismiss the existing review");
    await octokit.pulls.dismissReview({
      ...context.repo,
      pull_number: pull_request.number,
      review_id: reviewId,
      message: "Superseeded by new review",
      event: "DISMISSED",
    });
  }

  // Post a new review if we have comments
  if (comments.length > 0) {
    core.debug("Creating new review");
    await octokit.pulls.createReview({
      ...context.repo,
      pull_number: pull_request.number,
      body: reviewBody,
      event: "REQUEST_CHANGES",
      comments,
    });
  }
  core.info("Review created");
  core.endGroup();
}
