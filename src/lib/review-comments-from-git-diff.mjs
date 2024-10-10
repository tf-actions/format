import * as core from "@actions/core";
import { getExecOutput } from "@actions/exec";

export async function getChanges(files = []) {
	core.debug("Get changes from git diff");
	let args = [
		"diff",
		"--minimal", // Minimal diff
		"--unified=0", // No context lines
		"--no-color", // No color codes
	];
	if (files.length > 0) {
		args = args.concat(["--", ...files]);
	}
	core.debug(`args: ${args}`);
	const diff = await getExecOutput("git", args, { silent: true });

	const changes = [];
	const changedFiles = diff.stdout.split("diff --git").filter((n) => n);

	for (const fileDiff of changedFiles) {
		// Split the output lines into an array
		const lines = fileDiff.split("\n");

		// Skip the header lines
		while (!lines[0].startsWith("---")) {
			lines.shift();
		}

		// Get the file names
		const fromFile = lines.shift().replace("--- a/", "");
		const toFile = lines.shift().replace("+++ b/", "");

		// Split the file diff into chunks
		const diffChunks = lines
			.join("\n")
			.split(/@@ (-\d+(?:,\d+)? \+\d+(?:,\d+)?) @@/)
			.filter((n) => n);

		for (let i = 0; i < diffChunks.length; i += 2) {
			const fileRanges = diffChunks[i].replace(/[-\+]/g, "").split(" ");
			const changedLines = diffChunks[i + 1].split("\n"); //.filter((n) => n);
			let contextStart = "";
			while (
				!(changedLines[0].startsWith("-") || changedLines[0].startsWith("+"))
			) {
				contextStart += `${changedLines.shift()}\n`;
			}

			let contextEnd = "";
			while (
				!(
					changedLines[changedLines.length - 1].startsWith("-") ||
					changedLines[changedLines.length - 1].startsWith("+")
				)
			) {
				contextEnd = `${changedLines.pop()}\n${contextEnd}`;
			}

			let oldContent = "";
			let newContent = "";
			while (changedLines.length > 0) {
				const line = changedLines.shift();
				if (line.startsWith("-")) {
					oldContent += `${line.replace(/- ?/, "")}\n`;
				} else if (line.startsWith("+")) {
					newContent += `${line.replace(/\+ ?/, "")}\n`;
				} else {
					oldContent += `${line.replace(/ ? ?/, "")}\n`;
					newContent += `${line.replace(/ ? ?/, "")}\n`;
				}
			}

			changes.push({
				fromFile: {
					name: fromFile,
					start_line: Number(fileRanges[0].split(",")[0]),
					line_count: Number(fileRanges[0].split(",")[1]) || 1,
					content: oldContent,
				},
				toFile: {
					name: toFile,
					start_line: Number(fileRanges[1].split(",")[0]),
					line_count: Number(fileRanges[1].split(",")[1]) || 1,
					content: newContent,
				},
				context: {
					start: contextStart,
					end: contextEnd,
				},
			});
		}
	}
	return changes;
}

export function createReviewComments(changes) {
	const comments = [];
	for (const change of changes) {
		const comment = {
			path: change.toFile.name,
			// biome-ignore lint/style/useTemplate: A template literal would be less readable here
			body: "````suggestion\n" + change.toFile.content + "````",
		};

		// line is the last line to which the comment applies
		if (Math.max(change.fromFile.line_count, change.toFile.line_count) === 1) {
			comment.line = change.toFile.start_line;
		} else {
			comment.start_line = change.toFile.start_line;
			comment.line =
				change.toFile.start_line +
				(Math.max(change.fromFile.line_count, change.toFile.line_count) - 1);
		}
		comments.push(comment);
	}

	return comments;
}
