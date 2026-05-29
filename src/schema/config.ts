import { Schema } from "effect";

// Git URL pattern: supports https://, git@, git://, ssh:// formats
const gitUrlPattern = /^(https?:\/\/|git@|git:\/\/|ssh:\/\/).+/;

const TimeoutInput = Schema.Number.pipe(Schema.nonNegative());
const NonEmptyStringArray = Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
  Schema.filter((items) => items.length > 0 || "Provide at least one value"),
);

export const GitInstall = Schema.Struct({
  source: Schema.Literal("git"),
  repo: Schema.String.pipe(Schema.minLength(1), Schema.pattern(gitUrlPattern)),
  path: Schema.String.pipe(Schema.minLength(1)),
  branch: Schema.optional(Schema.String),
  sparse: Schema.optional(Schema.Array(Schema.String)),
});

export type GitInstall = Schema.Schema.Type<typeof GitInstall>;

export const BrewInstall = Schema.Struct({
  source: Schema.Literal("brew"),
  formula: Schema.optional(Schema.String),
  cask: Schema.optional(Schema.String),
  tap: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
}).pipe(
  Schema.filter((brew) => {
    const hasFormula = brew.formula !== undefined;
    const hasCask = brew.cask !== undefined;
    return hasFormula !== hasCask || "Provide exactly one of formula or cask for brew source";
  }),
);

export type BrewInstall = Schema.Schema.Type<typeof BrewInstall>;

export const DirInstall = Schema.Struct({
  source: Schema.Literal("dir"),
  path: Schema.String.pipe(Schema.minLength(1)),
});

export type DirInstall = Schema.Schema.Type<typeof DirInstall>;

export const SymlinkInstall = Schema.Struct({
  source: Schema.Literal("symlink"),
  path: Schema.String.pipe(Schema.minLength(1)),
  target: Schema.String.pipe(Schema.minLength(1)),
});

export type SymlinkInstall = Schema.Schema.Type<typeof SymlinkInstall>;

export const SkillsInstall = Schema.Struct({
  source: Schema.Literal("skills"),
  package: Schema.String.pipe(Schema.minLength(1)),
  repo: Schema.String.pipe(Schema.minLength(1)),
  ref: Schema.String.pipe(Schema.minLength(1)),
  path: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  skills: NonEmptyStringArray,
  agents: NonEmptyStringArray,
  mode: Schema.optional(Schema.Literal("copy", "symlink")),
}).pipe(
  Schema.filter((install) => {
    const invalidSkill = install.skills.find((skill) => skill.includes("/"));
    return (
      invalidSkill === undefined || `Skill names must not include path separators: ${invalidSkill}`
    );
  }),
);

export type SkillsInstall = Schema.Schema.Type<typeof SkillsInstall>;

export const InstallStrategy = Schema.Union(
  GitInstall,
  BrewInstall,
  DirInstall,
  SymlinkInstall,
  SkillsInstall,
  Schema.String.pipe(Schema.minLength(1)),
);

export type InstallStrategy = Schema.Schema.Type<typeof InstallStrategy>;
export type TimeoutInput = Schema.Schema.Type<typeof TimeoutInput>;

export const SystemItem = Schema.Struct({
  name: Schema.String,
  profiles: NonEmptyStringArray,
  tags: NonEmptyStringArray,
  check: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  onCheck: Schema.optional(Schema.Literal("exit-code", "path-exists")),
  install: InstallStrategy,
  update: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
  backup: Schema.optional(Schema.String),
  timeout: Schema.optional(TimeoutInput),
}).pipe(
  Schema.filter((item) => {
    if (item.check !== undefined) {
      return true;
    }

    return (
      (typeof item.install === "object" &&
        (item.install.source === "dir" ||
          item.install.source === "symlink" ||
          item.install.source === "skills")) ||
      "Provide check for shell, brew, and git install sources"
    );
  }),
);

export type SystemItem = Schema.Schema.Type<typeof SystemItem>;

export const SystemConfig = Schema.Struct({
  items: Schema.Array(SystemItem),
});

export type SystemConfig = Schema.Schema.Type<typeof SystemConfig>;
