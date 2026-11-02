# Lens: bugs

Look for defects the change brings in: code that does the wrong thing at
run time.

- Logic errors: an inverted or wrong condition, an off-by-one, a wrong
  operator, a case the branches miss, arithmetic on the wrong unit.
- Values that may be missing: `null` or `undefined` read, an empty list or
  string taken for a full one, a lookup that can miss.
- Asynchronous code: a promise not awaited, a race between two updates, an
  error swallowed or never reaching its caller, cleanup that never runs.
- State: a value mutated where a copy was expected, a stale value read after
  it changed, a cache or memo keyed on the wrong thing.
- Contracts: a caller left behind by a signature change, a returned shape
  the callers do not expect, an input the function no longer accepts.

Report only what the change itself introduces or makes reachable, with the
line where it goes wrong. Leave style, naming and missing tests to other
lenses. Topic `Bugs`, bucket `review`, unless the fix is mechanical and needs
no judgment: then `auto`.
