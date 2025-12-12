This zip contains Jest tests for the schemaHint helper.

Files:

- tests/schemaHint.test.ts
    - Imports describeShapeFromExamples from ../src/schemaHint
    - Verifies:
        - Simple ActorOutput-like examples generate a hint containing the expected keys.
        - Primitive type unions (number + string) are merged into a union in the output text.
        - Nested object examples produce nested field descriptions in the hint.

Usage:

1) Copy tests/schemaHint.test.ts into your repo's tests/ directory.
2) Ensure your Jest config is already set up to pick up tests/**/*.test.ts.
3) Run:

   npm test

The new tests will run alongside your existing suite.