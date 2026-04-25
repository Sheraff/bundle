// src/bundle-tracker.ts
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

// ../../node_modules/.pnpm/valibot@1.3.1_typescript@6.0.2/node_modules/valibot/dist/index.mjs
var store$4;
// @__NO_SIDE_EFFECTS__
function getGlobalConfig(config$1) {
  return {
    lang: config$1?.lang ?? store$4?.lang,
    message: config$1?.message,
    abortEarly: config$1?.abortEarly ?? store$4?.abortEarly,
    abortPipeEarly: config$1?.abortPipeEarly ?? store$4?.abortPipeEarly
  };
}
var store$3;
// @__NO_SIDE_EFFECTS__
function getGlobalMessage(lang) {
  return store$3?.get(lang);
}
var store$2;
// @__NO_SIDE_EFFECTS__
function getSchemaMessage(lang) {
  return store$2?.get(lang);
}
var store$1;
// @__NO_SIDE_EFFECTS__
function getSpecificMessage(reference, lang) {
  return store$1?.get(reference)?.get(lang);
}
// @__NO_SIDE_EFFECTS__
function _stringify(input) {
  const type = typeof input;
  if (type === "string") return `"${input}"`;
  if (type === "number" || type === "bigint" || type === "boolean") return `${input}`;
  if (type === "object" || type === "function") return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
  return type;
}
function _addIssue(context, label, dataset, config$1, other) {
  const input = other && "input" in other ? other.input : dataset.value;
  const expected = other?.expected ?? context.expects ?? null;
  const received = other?.received ?? /* @__PURE__ */ _stringify(input);
  const issue = {
    kind: context.kind,
    type: context.type,
    input,
    expected,
    received,
    message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
    requirement: context.requirement,
    path: other?.path,
    issues: other?.issues,
    lang: config$1.lang,
    abortEarly: config$1.abortEarly,
    abortPipeEarly: config$1.abortPipeEarly
  };
  const isSchema = context.kind === "schema";
  const message$1 = other?.message ?? context.message ?? /* @__PURE__ */ getSpecificMessage(context.reference, issue.lang) ?? (isSchema ? /* @__PURE__ */ getSchemaMessage(issue.lang) : null) ?? config$1.message ?? /* @__PURE__ */ getGlobalMessage(issue.lang);
  if (message$1 !== void 0) issue.message = typeof message$1 === "function" ? message$1(issue) : message$1;
  if (isSchema) dataset.typed = false;
  if (dataset.issues) dataset.issues.push(issue);
  else dataset.issues = [issue];
}
// @__NO_SIDE_EFFECTS__
function _getStandardProps(context) {
  return {
    version: 1,
    vendor: "valibot",
    validate(value$1) {
      return context["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig());
    }
  };
}
// @__NO_SIDE_EFFECTS__
function _isValidObjectKey(object$1, key) {
  return Object.hasOwn(object$1, key) && key !== "__proto__" && key !== "prototype" && key !== "constructor";
}
// @__NO_SIDE_EFFECTS__
function _joinExpects(values$1, separator) {
  const list = [...new Set(values$1)];
  if (list.length > 1) return `(${list.join(` ${separator} `)})`;
  return list[0] ?? "never";
}
var EMOJI_REGEX = new RegExp("^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}[\\u{E0030}-\\u{E0039}\\u{E0061}-\\u{E007A}]{1,3}\\u{E007F}|(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|(?![\\p{Emoji_Modifier_Base}\\u{1F1E6}-\\u{1F1FF}])\\p{Emoji_Presentation})(?:\\u200D(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|(?![\\p{Emoji_Modifier_Base}\\u{1F1E6}-\\u{1F1FF}])\\p{Emoji_Presentation}))*)+$", "u");
// @__NO_SIDE_EFFECTS__
function check(requirement, message$1) {
  return {
    kind: "validation",
    type: "check",
    reference: check,
    async: false,
    expects: null,
    requirement,
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "input", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function integer(message$1) {
  return {
    kind: "validation",
    type: "integer",
    reference: integer,
    async: false,
    expects: null,
    requirement: Number.isInteger,
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && !this.requirement(dataset.value)) _addIssue(this, "integer", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function maxLength(requirement, message$1) {
  return {
    kind: "validation",
    type: "max_length",
    reference: maxLength,
    async: false,
    expects: `<=${requirement}`,
    requirement,
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && dataset.value.length > this.requirement) _addIssue(this, "length", dataset, config$1, { received: `${dataset.value.length}` });
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function minValue(requirement, message$1) {
  return {
    kind: "validation",
    type: "min_value",
    reference: minValue,
    async: false,
    expects: `>=${requirement instanceof Date ? requirement.toJSON() : /* @__PURE__ */ _stringify(requirement)}`,
    requirement,
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && !(dataset.value >= this.requirement)) _addIssue(this, "value", dataset, config$1, { received: dataset.value instanceof Date ? dataset.value.toJSON() : /* @__PURE__ */ _stringify(dataset.value) });
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function nonEmpty(message$1) {
  return {
    kind: "validation",
    type: "non_empty",
    reference: nonEmpty,
    async: false,
    expects: "!0",
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && dataset.value.length === 0) _addIssue(this, "length", dataset, config$1, { received: "0" });
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function regex(requirement, message$1) {
  return {
    kind: "validation",
    type: "regex",
    reference: regex,
    async: false,
    expects: `${requirement}`,
    requirement,
    message: message$1,
    "~run"(dataset, config$1) {
      if (dataset.typed && !this.requirement.test(dataset.value)) _addIssue(this, "format", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function getFallback(schema, dataset, config$1) {
  return typeof schema.fallback === "function" ? schema.fallback(dataset, config$1) : schema.fallback;
}
// @__NO_SIDE_EFFECTS__
function getDefault(schema, dataset, config$1) {
  return typeof schema.default === "function" ? schema.default(dataset, config$1) : schema.default;
}
// @__NO_SIDE_EFFECTS__
function array(item, message$1) {
  return {
    kind: "schema",
    type: "array",
    reference: array,
    expects: "Array",
    async: false,
    item,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      const input = dataset.value;
      if (Array.isArray(input)) {
        dataset.typed = true;
        dataset.value = [];
        for (let key = 0; key < input.length; key++) {
          const value$1 = input[key];
          const itemDataset = this.item["~run"]({ value: value$1 }, config$1);
          if (itemDataset.issues) {
            const pathItem = {
              type: "array",
              origin: "value",
              input,
              key,
              value: value$1
            };
            for (const issue of itemDataset.issues) {
              if (issue.path) issue.path.unshift(pathItem);
              else issue.path = [pathItem];
              dataset.issues?.push(issue);
            }
            if (!dataset.issues) dataset.issues = itemDataset.issues;
            if (config$1.abortEarly) {
              dataset.typed = false;
              break;
            }
          }
          if (!itemDataset.typed) dataset.typed = false;
          dataset.value.push(itemDataset.value);
        }
      } else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function boolean(message$1) {
  return {
    kind: "schema",
    type: "boolean",
    reference: boolean,
    expects: "boolean",
    async: false,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (typeof dataset.value === "boolean") dataset.typed = true;
      else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function literal(literal_, message$1) {
  return {
    kind: "schema",
    type: "literal",
    reference: literal,
    expects: /* @__PURE__ */ _stringify(literal_),
    async: false,
    literal: literal_,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (dataset.value === this.literal) dataset.typed = true;
      else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function nullable(wrapped, default_) {
  return {
    kind: "schema",
    type: "nullable",
    reference: nullable,
    expects: `(${wrapped.expects} | null)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (dataset.value === null) {
        if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
        if (dataset.value === null) {
          dataset.typed = true;
          return dataset;
        }
      }
      return this.wrapped["~run"](dataset, config$1);
    }
  };
}
// @__NO_SIDE_EFFECTS__
function number(message$1) {
  return {
    kind: "schema",
    type: "number",
    reference: number,
    expects: "number",
    async: false,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (typeof dataset.value === "number" && !isNaN(dataset.value)) dataset.typed = true;
      else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function objectWithRest(entries$1, rest, message$1) {
  return {
    kind: "schema",
    type: "object_with_rest",
    reference: objectWithRest,
    expects: "Object",
    async: false,
    entries: entries$1,
    rest,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      const input = dataset.value;
      if (input && typeof input === "object") {
        dataset.typed = true;
        dataset.value = {};
        for (const key in this.entries) {
          const valueSchema = this.entries[key];
          if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
            const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
            const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key,
                value: value$1
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) issue.path.unshift(pathItem);
                else issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = valueDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!valueDataset.typed) dataset.typed = false;
            dataset.value[key] = valueDataset.value;
          } else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
          else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
            _addIssue(this, "key", dataset, config$1, {
              input: void 0,
              expected: `"${key}"`,
              path: [{
                type: "object",
                origin: "key",
                input,
                key,
                value: input[key]
              }]
            });
            if (config$1.abortEarly) break;
          }
        }
        if (!dataset.issues || !config$1.abortEarly) {
          for (const key in input) if (/* @__PURE__ */ _isValidObjectKey(input, key) && !(key in this.entries)) {
            const valueDataset = this.rest["~run"]({ value: input[key] }, config$1);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key,
                value: input[key]
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) issue.path.unshift(pathItem);
                else issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = valueDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!valueDataset.typed) dataset.typed = false;
            dataset.value[key] = valueDataset.value;
          }
        }
      } else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function optional(wrapped, default_) {
  return {
    kind: "schema",
    type: "optional",
    reference: optional,
    expects: `(${wrapped.expects} | undefined)`,
    async: false,
    wrapped,
    default: default_,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (dataset.value === void 0) {
        if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
        if (dataset.value === void 0) {
          dataset.typed = true;
          return dataset;
        }
      }
      return this.wrapped["~run"](dataset, config$1);
    }
  };
}
// @__NO_SIDE_EFFECTS__
function record(key, value$1, message$1) {
  return {
    kind: "schema",
    type: "record",
    reference: record,
    expects: "Object",
    async: false,
    key,
    value: value$1,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      const input = dataset.value;
      if (input && typeof input === "object") {
        dataset.typed = true;
        dataset.value = {};
        for (const entryKey in input) if (/* @__PURE__ */ _isValidObjectKey(input, entryKey)) {
          const entryValue = input[entryKey];
          const keyDataset = this.key["~run"]({ value: entryKey }, config$1);
          if (keyDataset.issues) {
            const pathItem = {
              type: "object",
              origin: "key",
              input,
              key: entryKey,
              value: entryValue
            };
            for (const issue of keyDataset.issues) {
              issue.path = [pathItem];
              dataset.issues?.push(issue);
            }
            if (!dataset.issues) dataset.issues = keyDataset.issues;
            if (config$1.abortEarly) {
              dataset.typed = false;
              break;
            }
          }
          const valueDataset = this.value["~run"]({ value: entryValue }, config$1);
          if (valueDataset.issues) {
            const pathItem = {
              type: "object",
              origin: "value",
              input,
              key: entryKey,
              value: entryValue
            };
            for (const issue of valueDataset.issues) {
              if (issue.path) issue.path.unshift(pathItem);
              else issue.path = [pathItem];
              dataset.issues?.push(issue);
            }
            if (!dataset.issues) dataset.issues = valueDataset.issues;
            if (config$1.abortEarly) {
              dataset.typed = false;
              break;
            }
          }
          if (!keyDataset.typed || !valueDataset.typed) dataset.typed = false;
          if (keyDataset.typed) dataset.value[keyDataset.value] = valueDataset.value;
        }
      } else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function strictObject(entries$1, message$1) {
  return {
    kind: "schema",
    type: "strict_object",
    reference: strictObject,
    expects: "Object",
    async: false,
    entries: entries$1,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      const input = dataset.value;
      if (input && typeof input === "object") {
        dataset.typed = true;
        dataset.value = {};
        for (const key in this.entries) {
          const valueSchema = this.entries[key];
          if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
            const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
            const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
            if (valueDataset.issues) {
              const pathItem = {
                type: "object",
                origin: "value",
                input,
                key,
                value: value$1
              };
              for (const issue of valueDataset.issues) {
                if (issue.path) issue.path.unshift(pathItem);
                else issue.path = [pathItem];
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) dataset.issues = valueDataset.issues;
              if (config$1.abortEarly) {
                dataset.typed = false;
                break;
              }
            }
            if (!valueDataset.typed) dataset.typed = false;
            dataset.value[key] = valueDataset.value;
          } else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
          else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
            _addIssue(this, "key", dataset, config$1, {
              input: void 0,
              expected: `"${key}"`,
              path: [{
                type: "object",
                origin: "key",
                input,
                key,
                value: input[key]
              }]
            });
            if (config$1.abortEarly) break;
          }
        }
        if (!dataset.issues || !config$1.abortEarly) {
          for (const key in input) if (!(key in this.entries)) {
            _addIssue(this, "key", dataset, config$1, {
              input: key,
              expected: "never",
              path: [{
                type: "object",
                origin: "key",
                input,
                key,
                value: input[key]
              }]
            });
            break;
          }
        }
      } else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function string(message$1) {
  return {
    kind: "schema",
    type: "string",
    reference: string,
    expects: "string",
    async: false,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      if (typeof dataset.value === "string") dataset.typed = true;
      else _addIssue(this, "type", dataset, config$1);
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function _subIssues(datasets) {
  let issues;
  if (datasets) for (const dataset of datasets) if (issues) issues.push(...dataset.issues);
  else issues = dataset.issues;
  return issues;
}
// @__NO_SIDE_EFFECTS__
function union(options, message$1) {
  return {
    kind: "schema",
    type: "union",
    reference: union,
    expects: /* @__PURE__ */ _joinExpects(options.map((option) => option.expects), "|"),
    async: false,
    options,
    message: message$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      let validDataset;
      let typedDatasets;
      let untypedDatasets;
      for (const schema of this.options) {
        const optionDataset = schema["~run"]({ value: dataset.value }, config$1);
        if (optionDataset.typed) if (optionDataset.issues) if (typedDatasets) typedDatasets.push(optionDataset);
        else typedDatasets = [optionDataset];
        else {
          validDataset = optionDataset;
          break;
        }
        else if (untypedDatasets) untypedDatasets.push(optionDataset);
        else untypedDatasets = [optionDataset];
      }
      if (validDataset) return validDataset;
      if (typedDatasets) {
        if (typedDatasets.length === 1) return typedDatasets[0];
        _addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(typedDatasets) });
        dataset.typed = true;
      } else if (untypedDatasets?.length === 1) return untypedDatasets[0];
      else _addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(untypedDatasets) });
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function unknown() {
  return {
    kind: "schema",
    type: "unknown",
    reference: unknown,
    expects: "unknown",
    async: false,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset) {
      dataset.typed = true;
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function pipe(...pipe$1) {
  return {
    ...pipe$1[0],
    pipe: pipe$1,
    get "~standard"() {
      return /* @__PURE__ */ _getStandardProps(this);
    },
    "~run"(dataset, config$1) {
      for (const item of pipe$1) if (item.kind !== "metadata") {
        if (dataset.issues && (item.kind === "schema" || item.kind === "transformation")) {
          dataset.typed = false;
          break;
        }
        if (!dataset.issues || !config$1.abortEarly && !config$1.abortPipeEarly) dataset = item["~run"](dataset, config$1);
      }
      return dataset;
    }
  };
}
// @__NO_SIDE_EFFECTS__
function safeParse(schema, input, config$1) {
  const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
  return {
    typed: dataset.typed,
    success: !dataset.issues,
    output: dataset.value,
    issues: dataset.issues
  };
}

// ../contracts/src/shared.ts
var SCHEMA_VERSION_V1 = 1;
var BUNDLE_ARTIFACT_OUTPUT_ENV_VAR = "BUNDLE_ARTIFACT_OUTPUT";
var DEFAULT_ARTIFACT_RELATIVE_PATH = ".bundle/artifact.json";
var PLUGIN_SCENARIO_KINDS = ["fixture-app", "synthetic-import"];
var ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
var ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var SCENARIO_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;
var GITHUB_OWNER_REGEX = /^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/;
var GITHUB_REPO_REGEX = /^[A-Za-z\d_.-]+$/;
var schemaVersionV1Schema = literal(SCHEMA_VERSION_V1);
var nonEmptyStringSchema = pipe(string(), nonEmpty());
var noteSchema = pipe(string(), maxLength(4e3));
var isoTimestampSchema = pipe(
  nonEmptyStringSchema,
  regex(ISO_TIMESTAMP_REGEX, "Expected an ISO-8601 UTC timestamp")
);
var ulidSchema = pipe(nonEmptyStringSchema, regex(ULID_REGEX, "Expected a ULID"));
var scenarioSlugSchema = pipe(
  nonEmptyStringSchema,
  regex(SCENARIO_SLUG_REGEX, "Expected a stable slug-like scenario id")
);
var gitShaSchema = pipe(
  nonEmptyStringSchema,
  regex(GIT_SHA_REGEX, "Expected a full git commit SHA")
);
var githubOwnerSchema = pipe(
  nonEmptyStringSchema,
  regex(GITHUB_OWNER_REGEX, "Expected a valid GitHub owner")
);
var githubRepoNameSchema = pipe(
  nonEmptyStringSchema,
  regex(GITHUB_REPO_REGEX, "Expected a valid GitHub repository name")
);
var positiveIntegerSchema = pipe(number(), integer(), minValue(1));
var nonNegativeIntegerSchema = pipe(number(), integer(), minValue(0));
var nonEmptyStringArraySchema = pipe(array(nonEmptyStringSchema), nonEmpty());
var stringRecordSchema = record(nonEmptyStringSchema, nonEmptyStringSchema);
var nonAllStringSchema = pipe(
  nonEmptyStringSchema,
  check((value) => value !== "all", '"all" is only valid on history and scenario pages')
);

// ../contracts/src/plugin-artifact.ts
var fileSizesV1Schema = strictObject({
  raw: nonNegativeIntegerSchema,
  gzip: nonNegativeIntegerSchema,
  brotli: nonNegativeIntegerSchema
});
var artifactWarningV1Schema = strictObject({
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema
});
var chunkModuleArtifactV1Schema = strictObject({
  rawId: nonEmptyStringSchema,
  renderedLength: nonNegativeIntegerSchema,
  originalLength: nonNegativeIntegerSchema
});
var chunkArtifactV1Schema = strictObject({
  fileName: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  isEntry: boolean(),
  isDynamicEntry: boolean(),
  facadeModuleId: nullable(nonEmptyStringSchema),
  imports: array(nonEmptyStringSchema),
  dynamicImports: array(nonEmptyStringSchema),
  implicitlyLoadedBefore: array(nonEmptyStringSchema),
  importedCss: array(nonEmptyStringSchema),
  importedAssets: array(nonEmptyStringSchema),
  modules: pipe(array(chunkModuleArtifactV1Schema), nonEmpty()),
  sizes: fileSizesV1Schema
});
var assetArtifactV1Schema = strictObject({
  fileName: nonEmptyStringSchema,
  names: nonEmptyStringArraySchema,
  originalFileNames: optional(array(nonEmptyStringSchema)),
  needsCodeReference: boolean(),
  sizes: fileSizesV1Schema
});
var viteManifestEntrySchema = objectWithRest(
  {
    src: optional(nonEmptyStringSchema),
    file: nonEmptyStringSchema,
    css: optional(array(nonEmptyStringSchema)),
    assets: optional(array(nonEmptyStringSchema)),
    isEntry: optional(boolean()),
    name: optional(nonEmptyStringSchema),
    isDynamicEntry: optional(boolean()),
    imports: optional(array(nonEmptyStringSchema)),
    dynamicImports: optional(array(nonEmptyStringSchema))
  },
  unknown()
);
var environmentArtifactV1Schema = strictObject({
  name: nonEmptyStringSchema,
  build: strictObject({
    outDir: nonEmptyStringSchema
  }),
  manifest: pipe(
    record(nonEmptyStringSchema, viteManifestEntrySchema),
    check(
      (manifest) => Object.keys(manifest).length > 0,
      "Each environment must include a non-empty manifest"
    )
  ),
  chunks: array(chunkArtifactV1Schema),
  assets: array(assetArtifactV1Schema),
  warnings: array(artifactWarningV1Schema)
});
var pluginArtifactV1Schema = strictObject({
  schemaVersion: schemaVersionV1Schema,
  pluginVersion: nonEmptyStringSchema,
  generatedAt: isoTimestampSchema,
  scenario: strictObject({
    id: scenarioSlugSchema,
    kind: union(PLUGIN_SCENARIO_KINDS.map((kind) => literal(kind)))
  }),
  build: strictObject({
    bundler: literal("vite"),
    bundlerVersion: nonEmptyStringSchema,
    rootDir: nonEmptyStringSchema
  }),
  environments: pipe(
    array(environmentArtifactV1Schema),
    nonEmpty(),
    check((environments) => {
      const names = environments.map((environment) => environment.name);
      return new Set(names).size === names.length;
    }, "Environment names must be unique within one artifact")
  )
});

// src/bundle-tracker.ts
var PLUGIN_VERSION = "0.0.0";
var DEFAULT_ENVIRONMENT_NAME = "default";
var DEFAULT_ARTIFACT_RELATIVE_PATH2 = DEFAULT_ARTIFACT_RELATIVE_PATH;
var bundleTrackerOptionsSchema = strictObject({
  scenario: scenarioSlugSchema,
  kind: optional(union([literal("fixture-app"), literal("synthetic-import")])),
  artifactOutput: optional(nonEmptyStringSchema)
});
function bundleTracker(options) {
  const normalizedOptions = parseBundleTrackerOptions(options);
  let artifactFile = "";
  let rootDir = "";
  let viteVersion = "";
  let expectedEnvironmentCount = 1;
  let artifactRemoved = false;
  let artifactWritten = false;
  const capturedEnvironments = /* @__PURE__ */ new Map();
  const capturedManifests = /* @__PURE__ */ new Map();
  return {
    name: "bundle-tracker",
    apply: "build",
    config(config) {
      expectedEnvironmentCount = 1 + Object.keys(config.environments ?? {}).length;
      return {
        build: {
          manifest: normalizeManifestConfigValue(config.build?.manifest)
        },
        environments: updateEnvironmentManifestConfig(config.environments)
      };
    },
    configResolved(config) {
      rootDir = config.root;
      const artifactOutput = readArtifactOutputOverride() ?? normalizedOptions.artifactOutput ?? DEFAULT_ARTIFACT_RELATIVE_PATH2;
      artifactFile = path.resolve(rootDir, artifactOutput);
    },
    async buildStart() {
      viteVersion = this.meta.viteVersion ?? viteVersion;
      if (artifactFile.length === 0) {
        throw new Error("Could not determine the artifact output path before build start");
      }
      if (artifactRemoved) {
        return;
      }
      artifactRemoved = true;
      await fs.rm(artifactFile, { force: true });
    },
    generateBundle(_, bundle) {
      const environmentName = getEnvironmentName(this.environment?.name);
      const environmentBuild = this.environment?.config?.build;
      const manifestSetting = normalizeResolvedManifestValue(
        environmentBuild?.manifest,
        environmentName
      );
      const outDir = requireNonEmptyString(
        environmentBuild?.outDir,
        `Environment "${environmentName}" is missing build.outDir`
      );
      const chunks = [];
      const assets = [];
      const manifestPath = toPosixPath(resolveManifestPath(manifestSetting));
      if (capturedEnvironments.has(environmentName)) {
        throw new Error(
          `Environment name "${environmentName}" was emitted more than once in one build`
        );
      }
      for (const fileName of Object.keys(bundle).sort((left, right) => left.localeCompare(right))) {
        const output = bundle[fileName];
        if (output.type === "chunk") {
          chunks.push(
            serializeChunk(
              output,
              environmentName,
              (rawId) => getModuleOriginalLength(this, rawId)
            )
          );
          continue;
        }
        if (shouldSkipAsset(fileName, manifestPath)) {
          continue;
        }
        assets.push(serializeAsset(output, environmentName));
      }
      capturedEnvironments.set(environmentName, {
        outDir,
        manifestPath,
        chunks: chunks.sort((left, right) => left.fileName.localeCompare(right.fileName)),
        assets: assets.sort((left, right) => left.fileName.localeCompare(right.fileName)),
        warnings: []
      });
    },
    async closeBundle() {
      const environmentName = getEnvironmentName(this.environment?.name);
      const capturedEnvironment = capturedEnvironments.get(environmentName);
      if (!capturedEnvironment) {
        return;
      }
      const outDir = path.resolve(rootDir, capturedEnvironment.outDir);
      capturedManifests.set(
        environmentName,
        await readManifest(path.join(outDir, capturedEnvironment.manifestPath), environmentName)
      );
      if (capturedManifests.size !== expectedEnvironmentCount || artifactWritten) {
        return;
      }
      artifactWritten = true;
      await writeArtifact({
        artifactFile,
        capturedEnvironments,
        capturedManifests,
        options: normalizedOptions,
        rootDir,
        viteVersion
      });
    }
  };
}
function updateEnvironmentManifestConfig(environments) {
  if (!environments) {
    return void 0;
  }
  return Object.fromEntries(
    Object.entries(environments).map(([environmentName, environmentConfig]) => [
      environmentName,
      {
        ...environmentConfig,
        build: {
          ...environmentConfig.build,
          manifest: normalizeManifestConfigValue(environmentConfig.build?.manifest)
        }
      }
    ])
  );
}
function parseBundleTrackerOptions(options) {
  const result = safeParse(bundleTrackerOptionsSchema, options);
  if (!result.success) {
    throw new Error(`Invalid bundleTracker options: ${formatIssues(result.issues)}`);
  }
  return {
    scenario: result.output.scenario,
    kind: result.output.kind ?? "fixture-app",
    artifactOutput: result.output.artifactOutput
  };
}
function serializeChunk(chunk, environmentName, getModuleOriginalLength2) {
  const modules = Object.entries(chunk.modules).map(([rawId, moduleInfo]) => ({
    rawId: requireNonEmptyString(
      rawId,
      `Environment "${environmentName}" has a chunk module with an empty id`
    ),
    renderedLength: requireNonNegativeInteger(
      moduleInfo.renderedLength,
      `Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module renderedLength`
    ),
    originalLength: resolveOriginalLength(
      rawId,
      moduleInfo.originalLength,
      getModuleOriginalLength2,
      `Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module originalLength`
    )
  }));
  if (modules.length === 0) {
    throw new Error(
      `Chunk "${chunk.fileName}" in environment "${environmentName}" is missing module membership`
    );
  }
  return {
    fileName: requireNonEmptyString(
      chunk.fileName,
      `Encountered a chunk with an empty fileName in environment "${environmentName}"`
    ),
    name: requireNonEmptyString(
      chunk.name,
      `Chunk "${chunk.fileName}" in environment "${environmentName}" is missing a name`
    ),
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    facadeModuleId: chunk.facadeModuleId ? requireNonEmptyString(
      chunk.facadeModuleId,
      `Chunk "${chunk.fileName}" in environment "${environmentName}" has an empty facadeModuleId`
    ) : null,
    imports: sortUniqueStrings(chunk.imports),
    dynamicImports: sortUniqueStrings(chunk.dynamicImports),
    implicitlyLoadedBefore: sortUniqueStrings(chunk.implicitlyLoadedBefore ?? []),
    importedCss: sortUniqueStrings(chunk.viteMetadata?.importedCss ?? []),
    importedAssets: sortUniqueStrings(chunk.viteMetadata?.importedAssets ?? []),
    modules: modules.sort((left, right) => left.rawId.localeCompare(right.rawId))
  };
}
function serializeAsset(asset, environmentName) {
  const fileName = requireNonEmptyString(
    asset.fileName,
    `Encountered an asset with an empty fileName in environment "${environmentName}"`
  );
  const names = sortUniqueStrings(asset.names ?? []);
  if (names.length === 0) {
    throw new Error(`Asset "${fileName}" in environment "${environmentName}" is missing names`);
  }
  const originalFileNames = sortUniqueStrings(asset.originalFileNames ?? []);
  return {
    fileName,
    names,
    ...originalFileNames.length > 0 ? { originalFileNames } : {},
    needsCodeReference: asset.needsCodeReference ?? false
  };
}
async function writeArtifact(input) {
  const environments = await Promise.all(
    [...input.capturedEnvironments.entries()].sort(([leftName], [rightName]) => leftName.localeCompare(rightName)).map(async ([environmentName, capturedEnvironment]) => {
      const manifest = input.capturedManifests.get(environmentName);
      if (!manifest) {
        throw new Error(`Environment "${environmentName}" is missing manifest data`);
      }
      const absoluteOutDir = path.resolve(input.rootDir, capturedEnvironment.outDir);
      return {
        name: environmentName,
        build: {
          outDir: capturedEnvironment.outDir
        },
        manifest,
        chunks: await Promise.all(
          capturedEnvironment.chunks.map(async (chunk) => ({
            ...chunk,
            sizes: await measureFile(
              path.join(absoluteOutDir, chunk.fileName),
              `chunk "${chunk.fileName}" in environment "${environmentName}"`
            )
          }))
        ),
        assets: await Promise.all(
          capturedEnvironment.assets.map(async (asset) => ({
            ...asset,
            sizes: await measureFile(
              path.join(absoluteOutDir, asset.fileName),
              `asset "${asset.fileName}" in environment "${environmentName}"`
            )
          }))
        ),
        warnings: capturedEnvironment.warnings
      };
    })
  );
  const candidateArtifact = {
    schemaVersion: SCHEMA_VERSION_V1,
    pluginVersion: PLUGIN_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    scenario: {
      id: input.options.scenario,
      kind: input.options.kind
    },
    build: {
      bundler: "vite",
      bundlerVersion: requireNonEmptyString(
        input.viteVersion,
        "Could not determine the Vite version for the current build"
      ),
      rootDir: requireNonEmptyString(input.rootDir, "Could not determine the Vite root directory")
    },
    environments
  };
  const parsedArtifact = safeParse(pluginArtifactV1Schema, candidateArtifact);
  if (!parsedArtifact.success) {
    throw new Error(`Generated artifact is invalid: ${formatIssues(parsedArtifact.issues)}`);
  }
  await fs.mkdir(path.dirname(input.artifactFile), { recursive: true });
  await fs.writeFile(input.artifactFile, `${JSON.stringify(parsedArtifact.output, null, 2)}
`);
}
async function readManifest(filePath, environmentName) {
  let contents;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Environment "${environmentName}" is missing the required Vite manifest at ${filePath}`,
      { cause: error }
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Environment "${environmentName}" has an unreadable manifest at ${filePath}`, {
      cause: error
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Environment "${environmentName}" has an invalid manifest payload at ${filePath}`
    );
  }
  return Object.fromEntries(
    Object.entries(parsed).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  );
}
async function measureFile(filePath, label) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Could not read ${label} at ${filePath}`, { cause: error });
  }
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer).byteLength,
    brotli: brotliCompressSync(buffer).byteLength
  };
}
function normalizeManifestConfigValue(value) {
  if (value === true || typeof value === "string") {
    return value;
  }
  return true;
}
function readArtifactOutputOverride() {
  const artifactOutput = process.env[BUNDLE_ARTIFACT_OUTPUT_ENV_VAR];
  return artifactOutput && artifactOutput.length > 0 ? artifactOutput : void 0;
}
function getModuleOriginalLength(pluginContext, rawId) {
  const sourceLength = readModuleSourceLength(rawId);
  if (sourceLength !== null) {
    return sourceLength;
  }
  const moduleInfo = pluginContext.getModuleInfo(rawId);
  if (!moduleInfo?.code) {
    return null;
  }
  return Buffer.byteLength(moduleInfo.code);
}
function normalizeResolvedManifestValue(value, environmentName) {
  if (value === true || typeof value === "string") {
    return value;
  }
  throw new Error(
    `Environment "${environmentName}" is missing build.manifest after config resolution`
  );
}
function resolveManifestPath(value) {
  return value === true ? path.join(".vite", "manifest.json") : value;
}
function shouldSkipAsset(fileName, manifestPath) {
  const normalizedFileName = toPosixPath(fileName);
  return normalizedFileName === manifestPath || normalizedFileName.endsWith(".map");
}
function getEnvironmentName(value) {
  return value && value.length > 0 ? value : DEFAULT_ENVIRONMENT_NAME;
}
function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}
function requireNonNegativeInteger(value, message) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(message);
  }
  return Number(value);
}
function resolveOriginalLength(rawId, value, getModuleOriginalLength2, message) {
  if (Number.isInteger(value) && Number(value) >= 0) {
    return Number(value);
  }
  const codeLength = getModuleOriginalLength2(rawId);
  if (codeLength !== null) {
    return codeLength;
  }
  throw new Error(message);
}
function readModuleSourceLength(rawId) {
  const filePath = stripQuery(rawId);
  if (!path.isAbsolute(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath).byteLength;
  } catch {
    return null;
  }
}
function sortUniqueStrings(values) {
  return [
    ...new Set(
      [...values].map((value) => requireNonEmptyString(value, "Expected a non-empty string"))
    )
  ].sort((left, right) => left.localeCompare(right));
}
function toPosixPath(value) {
  return value.replaceAll("\\", "/");
}
function stripQuery(value) {
  const queryIndex = value.indexOf("?");
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}
function formatIssues(issues) {
  return issues.map((issue) => issue.message).join("; ");
}
export {
  DEFAULT_ARTIFACT_RELATIVE_PATH2 as DEFAULT_ARTIFACT_RELATIVE_PATH,
  bundleTracker
};
