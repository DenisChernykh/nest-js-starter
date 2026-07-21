# Shared domain

Responsibility: framework-free domain primitives with multiple independent consumers.

Allowed dependencies: standard library only.

Add the first TypeScript file only after two real consumers require the same
primitive; do not move module-specific code here.
