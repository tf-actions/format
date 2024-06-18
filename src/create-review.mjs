import * as core from "@actions/core";
import * as github from "@actions/github";
import { getExecOutput } from "@actions/exec";
import parseGitDiff from "parse-git-diff";

// Much of this file is taken from https://github.com/parkerbxyz/suggest-changes
function generateSuggestionBody(changes) {
  return changes
    .filter(({ type }) => type === "AddedLine" || type === "UnchangedLine")
    .map(({ content }) => content)
    .join("\n");
}

export async function createReview(reviewBody) {
  core.startGroup("Creating code review");

  core.debug("Creating octokit client");
  const octokit = github.getOctokit(core.getInput("token", { required: true }));

  const pullRequestFiles = (
    await octokit.rest.pulls.listFiles({
      ...github.context.payload.repository,
      pull_number: github.context.payload.number,
    })
  ).data.map((file) => file.filename);

  const diff = await getExecOutput(
    "git",
    ["diff", "--unified=0", "--", ...pullRequestFiles],
    {
      silent: true,
    }
  );

  core.debug(`Git diff: ${diff.stdout}`);

  const changedFiles = parseGitDiff(diff.stdout).files.filter(
    (/** @type {{ type: string; }} */ file) => file.type === "ChangedFile"
  );

  // Create an array of comments with suggested changes for each chunk of each changed file
  const comments = changedFiles.flatMap(({ path, chunks }) =>
    chunks.map(({ fromFileRange, changes }) => ({
      path,
      start_line: fromFileRange.start,
      // The last line of the chunk is the start line plus the number of lines in the chunk
      // minus 1 to account for the start line being included in fromFileRange.lines
      line: fromFileRange.start + fromFileRange.lines - 1,
      start_side: "RIGHT",
      side: "RIGHT",
      // Quadruple backticks allow for triple backticks in a fenced code block in the suggestion body
      // https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks#fenced-code-blocks
      body: "````suggestion\n" + generateSuggestionBody(changes) + "\n````",
    }))
  );

  core.debug("Listing reviews on the pull request");
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    ...github.context.payload.repository,
    pull_number: github.context.payload.number,
  });
  core.debug(`Retrieved ${length(reviews)} reviews`);

  core.debug("Finding existing review");
  const reviewId = reviews.find(
    (review) => review.user.type === "Bot" && review.body === reviewBody
  )?.id;
  core.debug(`Review ID: ${reviewId}`);

  let query;
  if (reviewId) {
    // I think we need to delete and recreate as it seems the update
    // can't update the comments associated with the review, only the review itself
    core.debug(`Updating review ${reviewId}`);
    query = `
      mutation UpdateReview{
        updatePullRequestReview(input: {
          pullRequestReviewId: "${reviewId}",
          body: ${reviewBody},
          comments: ${comments},
          commitOID: ${github.context.sha},
          event: REQUEST_CHANGES
        }) {
          pullRequestReview {
            updatedAt
          }
        }
      }
    `;
  } else {
    core.debug("Creating new review");
    query = `
      mutation CreateReview{
        addPullRequestReview(input: {
          pullRequestId: "${github.context.payload.pull_request.id}",
          body: ${reviewBody},
          comments: ${comments},
          commitOID: ${github.context.sha},
          event: REQUEST_CHANGES
        }) {
          pullRequestReview {
            createdAt
          }
        }
      }
    `;
  }
  core.debug(`query: ${query}`);
  await octokit.graphql(query);
  core.info("Review created");
  core.endGroup();
}
