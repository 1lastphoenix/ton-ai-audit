# Sandbox Runner Placeholder

This container is the reserved execution zone for untrusted contract verification.

Security intent for production deployment:
- Disable outbound internet.
- Strict CPU/memory/time limits.
- Isolated filesystem mounts.
- Per-job ephemeral workspaces.

Current v1 scaffold uses deterministic static verification in workers, with this directory
prepared for full isolated toolchain execution rollout.
