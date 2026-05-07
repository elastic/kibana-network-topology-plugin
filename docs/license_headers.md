## License headers

This repository uses the same Elastic License 2.0 header text as Kibana.

### Header template

The canonical header text lives in:

- `licenses/ELASTIC-LICENSE-2.0-HEADER.txt`

All eligible source files must start with that exact comment block (after an optional shebang line).

### Which files require headers

We require headers for:

- `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs`

This includes TypeScript declaration files (`*.d.ts`).

### Exemptions

The following paths are excluded from header checking and auto-fixing:

- `node_modules/`
- `.git/`
- `build/`
- `target/`

If we add vendored or generated code in the future, add an explicit exemption and document why.

### How it’s enforced

- **Check**: `yarn check:license_headers`
- **Auto-fix**: `yarn fix:license_headers`

The `lint` script runs the license header check first to prevent introducing new files without headers.

### SPDX identifiers

We do **not** add SPDX identifiers in file headers today. The license is expressed via the full header text and the repository-level `LICENSE.txt`.

