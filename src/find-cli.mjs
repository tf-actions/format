import * as core from "@actions/core";
import * as os from "os";
import * as io from "@actions/io";

export async function findTerraformCLI() {
  core.debug("Searching for Terraform CLI");

  let terraformPath = "";
  const exeSuffix = os.platform().startsWith("win") ? ".exe" : "";

  try {
    // Looking for terraform-bin in case the wrapper from setup-terraform is in use
    core.debug("Looking for `terraform-bin`");
    terraformPath = await io.which(`terraform-bin${exeSuffix}`, true);
  } catch {
    core.debug("`terraform-bin` not found");
    try {
      core.debug("Looking for `terraform`");
      terraformPath = await io.which(`terraform${exeSuffix}`, true);
    } catch {
      throw new Error("Terraform CLI not found");
    }
  }
  core.debug(`Found terraform binary at ${terraformPath}`);
  return terraformPath;
}
