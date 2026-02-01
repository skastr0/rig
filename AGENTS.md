# System Setup - AI Agent Instructions

## ⛔️ VALIDATION IS MANDATORY - NO EXCEPTIONS ⛔️

### 🚨 CRITICAL: After EVERY Code Change You MUST Run:

```bash
bun run validate  # Runs typecheck + lint + format:check
bun run test      # Runs all tests
```

**BOTH commands must pass with zero errors/warnings/failures.**

### ✅ Work is NOT Complete Until ALL of These Pass:

1. **TypeScript** - `bun run typecheck` passes with 0 errors
2. **Linting** - `bun run lint` passes with 0 warnings or errors
3. **Formatting** - `bun run format:check` passes with 0 issues
4. **Tests** - `bun run test` passes with 0 failures
5. **Build** - `bun run build` succeeds

### ⛔️ ABSOLUTELY FORBIDDEN:

- ❌ Claiming work is "complete" or "done" when validation fails
- ❌ Skipping validation steps ("I'll run them later")
- ❌ Ignoring warnings or errors ("They're just warnings")
- ❌ Only running `bun run build` without the validators
- ❌ Saying "tests should pass" without actually running them
- ❌ Marking todos as complete before validation passes

### 🚨 CRITICAL REMINDER:

**BUILD SUCCESS ≠ WORK COMPLETE**

The build can succeed while:
- TypeScript has type errors
- Tests are failing
- Code has linting issues  
- Formatting is incorrect
- Runtime bugs exist

**Always run `bun run validate && bun run test` before considering work complete.**

---

## Development Guidelines

For Effect-TS patterns, error handling, service definitions, and other development guidelines, see:

- **[GUIDELINES.md](./GUIDELINES.md)** - Comprehensive Effect-TS development patterns and rules
