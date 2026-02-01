import { Schema } from "effect";

// Git URL pattern: supports https://, git@, git://, ssh:// formats
const gitUrlPattern = /^(https?:\/\/|git@|git:\/\/|ssh:\/\/).+/;

export const GitInstall = Schema.Struct({
  source: Schema.Literal("git"),
  repo: Schema.String.pipe(Schema.minLength(1), Schema.pattern(gitUrlPattern)),
  path: Schema.String.pipe(Schema.minLength(1)),
  branch: Schema.optional(Schema.String),
  sparse: Schema.optional(Schema.Array(Schema.String)),
});

export type GitInstall = Schema.Schema.Type<typeof GitInstall>;

export const InstallStrategy = Schema.Union(Schema.String.pipe(Schema.minLength(1)), GitInstall);

export type InstallStrategy = Schema.Schema.Type<typeof InstallStrategy>;

export const SystemItem = Schema.Struct({
  name: Schema.String,
  check: Schema.String,
  onCheck: Schema.optional(Schema.Literal("exit-code", "path-exists")),
  install: InstallStrategy,
  update: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
  backup: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
});

export type SystemItem = Schema.Schema.Type<typeof SystemItem>;

export const Profile = Schema.Struct({
  exclude: Schema.optional(Schema.Array(Schema.String)),
  items: Schema.optional(Schema.Array(SystemItem)),
});

export type Profile = Schema.Schema.Type<typeof Profile>;

export const SystemConfig = Schema.Struct({
  profiles: Schema.optional(Schema.Record({ key: Schema.String, value: Profile })),
  items: Schema.Array(SystemItem),
});

export type SystemConfig = Schema.Schema.Type<typeof SystemConfig>;
