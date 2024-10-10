import * as core from "@actions/core";
import * as github from "@actions/github";
import {
	getChanges,
	createReviewComments,
} from "./review-comments-from-git-diff.mjs";
const { context } = github;
const { pull_request } = context.payload;

const extensions = ["tf", "tfvars"];
const reviewTag = "<!-- oWretch/terraform-format review -->";

export async function createReview(cliName) {
	core.debug("Creating a review");
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
	core.debug(`pullRequestFileNames: ${JSON.stringify(pullRequestFileNames)}`);

	const changes = await getChanges(pullRequestFileNames);
	const comments = createReviewComments(changes);

	// Find the existing review(s), if they exists
	core.debug("Listing existing reviews on the pull request");
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
						review.user.type === "Bot" &&
						review.state === "CHANGES_REQUESTED" &&
						review.body.includes(reviewTag)
					) {
						core.debug(`Found outstanding review ID: ${review.id}`);
						return review;
					}
				})
				.filter((n) => n),
	);
	core.debug(`Review IDs: ${JSON.stringify(reviews.map((r) => r.id))}`);

	for (const review of reviews) {
		core.debug(`Processing existing review: ${review.id}`);

		let message = "Superseeded by new review";
		let commentCloseClassifier = "OUTDATED";
		if (comments.length === 0 && reviews.at(-1).id === review.id) {
			// If we have no more changes, and we are dealing with the last review
			// set the message to indicate the review is correctly resolved
			message = "All formatting issues have been resolved";
			commentCloseClassifier = "RESOLVED";
		}

		// Resolve the review comments
		core.debug("Get the review comments");
		const oldComments = await octokit.paginate(
			octokit.rest.pulls.listCommentsForReview,
			{
				...context.repo,
				pull_number: pull_request.number,
				review_id: review.id,
			},
			(response) => response.data.map((comment) => comment),
		);
		for (const comment of oldComments) {
			core.debug(`Hide the review comment ${comment.id}`);
			await octokit.graphql(
				`
          mutation hideComment($id: ID!, $classifier: ReportedContentClassifiers!) {
            minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
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
					id: comment.node_id,
					classifier: commentCloseClassifier,
				},
			);
		}

		core.debug("Hide the review comment");
		await octokit.graphql(
			`
		    mutation hideComment($id: ID!, $classifier: ReportedContentClassifiers!) {
		      minimizeComment(input: {subjectId: $id, classifier: $classifier}) {
		        clientMutationId
		        minimizedComment {
		          isMinimized
		          minimizedReason
		          viewerCanMinimize
		        }
		      }
		    }
		  `,
			{ id: review.node_id, classifier: commentCloseClassifier },
		);

		// Dismiss the existing review as superseeded
		core.debug("Dismiss the existing review as superseeded");
		await octokit.rest.pulls.dismissReview({
			...context.repo,
			pull_number: pull_request.number,
			review_id: review.id,
			message: message,
			event: "DISMISS",
		});
	}

	// Post a new review if we have comments
	if (comments.length > 0) {
		core.debug("Creating new review");

		const changedFileNames = [
			...new Set(changes.map((change) => change.toFile.name)),
		];

		await octokit.rest.pulls.createReview({
			...context.repo,
			pull_number: pull_request.number,
			event: "REQUEST_CHANGES",
			comments,
			body: `\
# Formatting Review
${changedFileNames.length} files in this pull request have formatting issues. \
Please run \`${cliName} fmt\` to fix them.

<details>

<summary>Files with formatting issues</summary>

${changedFileNames.map((n) => `- \`${n}\``).join("\n")}

</details>
${reviewTag}
`,
		});
	}
	core.info("Review created");
}
