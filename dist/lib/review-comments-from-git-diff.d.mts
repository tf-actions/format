import type { Change } from "@owretch/git-diff";
export default function (changes: Set<Change>): Set<ReviewComment>;
export type ReviewComment = {
    path: string;
    body: string;
    line: number;
    start_line?: number;
};
