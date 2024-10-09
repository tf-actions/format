import * as core from "@actions/core";
import * as github from "@actions/github";
import {
	getChanges,
	createReviewComments,
} from "./review-comments-from-git-diff.mjs";
const { context = {} } = github;
const { pull_request } = context.payload;

const extensions = ["tf", "tfvars"];
const reviewTag = "<!-- oWretch/terraform-format review -->";

export async function createReview() {
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
		(response) =>
			response.data
				.map((file) => {
					if (
						extensions.includes(file.filename.split(".").pop().toLowerCase())
					) {
						return file.filename;
					}
				})
				.filter((n) => n),
	);
	console.debug(
		`pullRequestFileNames: ${JSON.stringify(pullRequestFileNames)}`,
	);

	const changes = await getChanges(pullRequestFileNames);
	const changedFiles = changes.map((change) => change.file);

	const comments = createReviewComments(changes);

	// Find the existing review(s), if they exists
	core.debug("Listing reviews on the pull request");
	const reviewIds = await octokit.paginate(
		octokit.rest.pulls.listReviews,
		{
			...context.repo,
			pull_number: pull_request.number,
		},
		(response) =>
			response.data
				.map((review) => {
					if (
						review.user.type === "Bot" &&
						review.state === "CHANGES_REQUESTED" &&
						review.body.includes(reviewTag)
					) {
						core.debug(`Found existing review ID: ${review.id}`);
						return review.id;
					}
				})
				.filter((n) => n),
	);
	core.debug(`Review IDs: ${JSON.stringify(reviewIds)}`);

	for (const reviewId of reviewIds) {
		let message = "Superseeded by new review";
		let commentCloseClassifier = "OUTDATED";
		if (comments.length > 0 && reviewIds.at(-1) === reviewId) {
			// If we have no more changes, and we are dealing with the last review
			// set the message to indicate the review is correctly resolved
			message = "All formatting issues have been resolved";
			commentCloseClassifier = "RESOLVED";
		}

		// Resolve the review comments
		const oldComments = await octokit.rest.pulls.listCommentsForReview({
			...context.repo,
			pull_number: pull_request.number,
			review_id: reviewId,
		});
		for (const comment of oldComments.data) {
			core.debug("Hide the review comment");
			await octokit.graphql(
				`
          mutation hideComment($id: ID!) {
            minimizeComment(input: {classifier: $classifier, subjectId: $id}) {
              clientMutationId
              minimizedComment {
                isMinimized
                minimizedReason
                viewerCanMinimize
              }
            }
          }
        `,
				{
					id: comment.id,
					classifier: commentCloseClassifier,
				},
			);
		}

		// core.debug("Hide the review comment");
		// await octokit.graphql(
		// 	`
		//     mutation hideComment($id: ID!) {
		//       minimizeComment(input: {classifier: $classifier, subjectId: $id}) {
		//         clientMutationId
		//         minimizedComment {
		//           isMinimized
		//           minimizedReason
		//           viewerCanMinimize
		//         }
		//       }
		//     }
		//   `,
		// 	{ id: reviewId, classifier: commentCloseClassifier },
		// );

		// Dismiss the existing review as superseeded
		core.debug("Dismiss the existing review as superseeded");
		await octokit.rest.pulls.dismissReview({
			...context.repo,
			pull_number: pull_request.number,
			review_id: reviewId,
			message: message,
			event: "DISMISS",
		});
	}

	// Post a new review if we have comments
	if (comments.length > 0) {
		core.debug("Creating new review");
		await octokit.rest.pulls.createReview({
			...context.repo,
			pull_number: pull_request.number,
			event: "REQUEST_CHANGES",
			comments,
			body: `\
# Formatting Review
${changedFiles.length} files in this pull request have formatting issues. \
Please run \`${cliName} fmt\` to fix them.
<details>
<summary>Files with formatting issues</summary>
\`${changedFiles.join("`\n`")}\`
</details>
${reviewTag}
`,
		});
	}
	core.info("Review created");
}
