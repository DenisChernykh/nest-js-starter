# TSDoc guidelines

TSDoc is an optional, explicitly requested task for exported public application
contracts, ports, domain policies/value objects with non-obvious invariants,
and hand-written helpers whose contract is not fully obvious from types. Normal
development does not require adding or updating it.

Run `pnpm lint:tsdoc` only when that task is in scope. It reports findings as
warnings and is not part of `pnpm lint`, `pnpm check:quick`, or `pnpm check`.

When TSDoc is requested, documentation explains guarantees, invariants, failure
behavior and ownership; it does not repeat the symbol name.

Use tags by contract:

- `@remarks` for lifecycle, security, consistency or ownership constraints that
  do not fit the summary;
- `@param` for every non-obvious parameter;
- `@returns` when the result has guarantees beyond its static type;
- `@throws` for each intentional failure category callers must handle;
- `@packageDocumentation` only on a package/public-boundary entrypoint.

An exported interface with self-explanatory readonly fields needs a precise
summary; a function that performs I/O, validation or publication also documents
parameters, result and failure behavior. TSDoc must not promise stronger
atomicity or durability than the implementation provides.

Tests use descriptive `describe`/`it` names instead of formal TSDoc. Generated
code and intentionally invalid architecture fixtures follow their own checked
contracts.
