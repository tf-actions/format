import * as core from "@actions/core";
import * as io from "@actions/io";

export async function findCLI() {
	core.debug("Searching for CLI");

	let cliPath = "";
	const exeSuffix = platform.isWindows ? ".exe" : "";

	if (core.getInput("cli_path")) {
		core.debug(`Looking for CLI path from input: ${cliPath}`);
		cliPath = core.getInput("cli_path");
		if (!cliPath.endsWith(exeSuffix)) {
			cliPath += exeSuffix;
		}
		try {
			await io.which(cliPath, true);
			return cliPath;
		} catch {
			core.warning(`CLI path from input not found: ${cliPath}`);
			core.debug("Searching for CLI in PATH");
		}
	}

	try {
		// Looking for tofu-bin in case the wrapper from setup-opentofu is in use
		core.debug("Looking for tofu-bin");
		await io.which(cliPath, true);
		core.info(`Using tofu binary at ${cliPath}`);
		return cliPath;
	} catch {
		core.debug("`tofu-bin` not found");
		try {
			core.debug("Looking for `tofu`");
			cliPath = await io.which(`tofu${exeSuffix}`, true);
			core.info(`Using tofu binary at ${cliPath}`);
			return cliPath;
		} catch {
			core.warning("tofu binary not found");
		}
	}

	try {
		// Looking for terraform-bin in case the wrapper from setup-terraform is in use
		core.debug("Looking for `terraform-bin`");
		cliPath = await io.which(`terraform-bin${exeSuffix}`, true);
		core.info(`Using terraform binary at ${cliPath}`);
		return cliPath;
	} catch {
		core.debug("`terraform-bin` not found");
		try {
			core.debug("Looking for `terraform`");
			cliPath = await io.which(`terraform${exeSuffix}`, true);
			core.info(`Using terraform binary at ${cliPath}`);
			return cliPath;
		} catch {
			core.warning("terraform binary not found");
		}
	}
	throw new Error("CLI not found");
}
