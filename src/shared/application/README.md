# Shared application

Responsibility: stable application contracts with multiple independent consumers.

Allowed dependencies: shared domain only.

Add the first TypeScript file only after two real consumers require the same
contract; do not move module-specific code here.
