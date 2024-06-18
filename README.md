# terraform-format GitHub Action

A javascript GitHub Action to format a Terraform configuration, and post a code review on the pull request highlighting issues.

The action will initialise the Terraform working directory by default.
This can be disabled with the `init` parameter.

A summary will be posted with details of any validation errors.

## Inputs

### `token`

Description: The GitHub token to use for interacting with the repostiory

Required : `false`

### `init`

Description: Run terraform init before validating

Default: `"true"`

### `recursive`

Description: Recursively check the formating

Default: `"false"`

### `create-review`

Description: Create a code review on the Pull Request

Default: `"false"`

## Outputs

No outputs are returned.

## Example usage

Check formatting and fail if it needs to be updated.

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Setup Terraform
    uses: hashicorp/setup-terraform@v3

  - name: Format Configuration
    uses: oWretch/terraform-format@v1
```

Check formatting and create a code review with the required updates.

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Setup Terraform
    uses: hashicorp/setup-terraform@v3

  - name: Format Configuration
    uses: oWretch/terraform-format@v1
    with:
      create-review: true
      token: ${{ secrets.GITHUB_TOKEN }}
```
