import * as core from "@actions/core";
import { which } from "@actions/io";
import * as os from "node:os";
import * as path from "node:path";
export async function findCLI() {
    core.debug("Searching for CLI");
    let cliPath;
    const exeSuffix = os.platform().startsWith("win") ? ".exe" : "";
    if (core.getInput("cli_path")) {
        cliPath = core.getInput("cli_path");
        if (cliPath === "") {
            throw new Error("CLI path is empty");
        }
        if (!cliPath.endsWith(exeSuffix)) {
            core.debug("Adding exe suffix to CLI path");
            cliPath += exeSuffix;
        }
        core.debug(`Looking for CLI path from input: ${cliPath}`);
        try {
            const cli = await which(cliPath, true);
            let cliName = "";
            switch (cli.split(path.sep).pop()) {
                case "tofu":
                case "tofu-bin":
                    cliName = "tofu";
                    break;
                case "terraform":
                case "terraform-bin":
                    cliName = "terraform";
                    break;
                default:
                    cliName = cli.split(path.sep).pop() ?? "";
            }
            core.info(`Using ${cliName} binary at ${cliPath}`);
            return { cliPath: cliPath, cliName: cliName };
        }
        catch {
            core.info(`CLI path from input not found: ${cliPath}`);
        }
    }
    if (process.env.TOFU_CLI_PATH) {
        cliPath = path.join(process.env.TOFU_CLI_PATH, `tofu-bin${exeSuffix}`);
        core.debug(`Looking for CLI path from TOFU_CLI_PATH: ${cliPath}`);
        try {
            await which(cliPath, true);
            core.info(`Using tofu binary at ${cliPath}`);
            return { cliPath: cliPath, cliName: "tofu" };
        }
        catch {
            core.info(`CLI not found using TOFU_CLI_PATH: ${cliPath}`);
        }
    }
    if (process.env.TERRAFORM_CLI_PATH) {
        cliPath = path.join(process.env.TERRAFORM_CLI_PATH, `terraform-bin${exeSuffix}`);
        core.debug(`Looking for CLI path from TERRAFORM_CLI_PATH: ${cliPath}`);
        try {
            await which(cliPath, true);
            core.info(`Using terraform binary at ${cliPath}`);
            return { cliPath: cliPath, cliName: "terraform" };
        }
        catch {
            core.info(`CLI not found using TERRAFORM_CLI_PATH: ${cliPath}`);
        }
    }
    try {
        core.debug("Looking for `tofu`");
        cliPath = await which(`tofu${exeSuffix}`, true);
        core.info(`Using tofu binary at ${cliPath}`);
        return { cliPath: cliPath, cliName: "tofu" };
    }
    catch {
        core.info("tofu binary not found");
    }
    try {
        core.debug("Looking for `terraform`");
        cliPath = await which(`terraform${exeSuffix}`, true);
        core.info(`Using terraform binary at ${cliPath}`);
        return { cliPath: cliPath, cliName: "terraform" };
    }
    catch {
        core.info("terraform binary not found");
    }
    throw new Error("CLI not found");
}