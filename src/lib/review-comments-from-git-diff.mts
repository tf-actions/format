import * as core from "@actions/core";
import type { Change } from "@owretch/git-diff";

export default function (changes: Set<Change>): Set<ReviewComment> {
	const comments = new Set<ReviewComment>();
	for (const change of changes) {
		if (!change.toFile) {
			// @TODO: Handle deleted files
			continue;
		}

		const comment = {
			path: change.toFile.name,
			// biome-ignore lint/style/useTemplate: Number of backticks
			body: "````suggestion\n" + change.toFile.content + "````",
		} as ReviewComment;

		// `line` should be the last line number of the change for the review
		if (
			Math.max(change.fromFile?.line_count ?? 0, change.toFile.line_count) === 1
		) {
			comment.line = change.toFile.start_line;
		} else {
			comment.start_line = change.toFile.start_line;
			comment.line =
				change.toFile.start_line +
				(Math.max(change.fromFile?.line_count ?? 0, change.toFile.line_count) -
					1);
		}
		comments.add(comment);
	}

	return comments;
}

export type ReviewComment = {
	path: string;
	body: string;
	line: number;
	start_line?: number;
};
